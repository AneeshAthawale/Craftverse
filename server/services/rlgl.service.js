/**
 * RLGL service — server-authoritative Red Light Green Light state machine.
 *
 * Source of truth is the RLGL game row's `games.config` JSONB:
 *
 *   config = {
 *     problem:            { id, title, domain, difficulty, description,
 *                           starterCode, fnName, testCases: [{ input[], expected }] },
 *     countdownSeconds:   number (admin-tunable via PATCH /api/games/:id),
 *     state: {
 *       light:            'GREEN' | 'RED',
 *       gameStatus:       'WAITING' | 'ACTIVE' | 'COMPLETED',
 *       transition:       null | { to: 'GREEN'|'RED', appliesAt: ISO timestamp },
 *       updatedAt:        ISO timestamp,
 *     },
 *   }
 *
 * A pending transition is ONLY a persisted deadline (`appliesAt`). The current
 * `light` is never changed at schedule time — it stays authoritative until the
 * deadline passes. The transition target (`to`) is fixed when scheduled, so a
 * repeated admin click cannot re-target an in-flight transition.
 *
 * The same "persist first, broadcast after" rule used by event/game status
 * applies here: the DB write always lands before any socket broadcast.
 */
import vm from 'node:vm';
import { query, getClient } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';

export const LIGHTS = ['GREEN', 'RED'];
export const GAME_STATUSES = ['WAITING', 'ACTIVE', 'COMPLETED'];
export const RESULT_STATUSES = ['PLAYING', 'QUALIFIED', 'DISQUALIFIED', 'WINNER'];

export const RLGL_ROUTE = 'rlgl';

/** Defaults used when an existing RLGL row has no config yet (migrated rows). */
const DEFAULT_CONFIG = {
  problem: null,
  countdownSeconds: 3,
  state: {
    light: 'GREEN',
    gameStatus: 'WAITING',
    transition: null,
    updatedAt: new Date().toISOString(),
  },
};

/** Process-local schedulers keyed by game id (see module notes + pruneTimers). */
const schedulers = new Map();

// ---------------------------------------------------------------------------
// Reading / writing the RLGL row
// ---------------------------------------------------------------------------

async function getRlglRow() {
  const { rows } = await query('SELECT game_id, name, status, config FROM games WHERE route = $1', [
    RLGL_ROUTE,
  ]);
  if (!rows[0]) throw ApiError.notFound('RLGL game not found');
  return rows[0];
}

function normalizeConfig(config) {
  const merged = { ...DEFAULT_CONFIG, ...(config ?? {}) };
  merged.state = {
    ...DEFAULT_CONFIG.state,
    ...(merged.state ?? {}),
    transition: merged.state?.transition ?? null,
  };
  // Coerce server timestamps to numbers once for every consumer.
  if (merged.state.transition?.appliesAt) {
    merged.state.transition.appliesAt = new Date(merged.state.transition.appliesAt).getTime();
  }
  if (merged.state.updatedAt) {
    merged.state.updatedAt = new Date(merged.state.updatedAt).toISOString();
  }
  return merged;
}

/** Serialize a config for storage with the next state + a fresh updatedAt. */
function buildConfig(config, nextState) {
  return {
    ...config,
    state: {
      ...nextState,
      updatedAt: new Date().toISOString(),
    },
  };
}

/** pg returns NUMERIC/BIGINT as strings; normalize for consistent JSON. */
function normalizeResult(result) {
  if (!result) return null;
  return {
    ...result,
    game_id: String(result.game_id),
    team_id: String(result.team_id),
    rank: result.rank === null ? null : Number(result.rank),
    score: result.score === null ? null : Number(result.score),
    time_seconds: result.time_seconds === null ? null : Number(result.time_seconds),
  };
}

async function updateConfig(nextState) {
  const row = await getRlglRow();
  const config = normalizeConfig(row.config);
  const { rows } = await query(
    `UPDATE games SET config = $1, updated_at = now()
     WHERE game_id = $2 AND route = $3
     RETURNING game_id, name, status, config`,
    [buildConfig(config, nextState), row.game_id, RLGL_ROUTE]
  );
  if (!rows[0]) throw ApiError.notFound('RLGL game not found');
  const updated = rows[0];
  return { config: normalizeConfig(updated.config), game: updated };
}

/** Read the authoritative RLGL state (always heals an expired pending deadline). */
export async function getRlglState() {
  const row = await getRlglRow();
  const config = normalizeConfig(row.config);

  // Healing read: a persisted deadline that already passed without being
  // applied (server was down / timer lost) is applied here, persist-first.
  if (config.state.transition && Date.now() >= config.state.transition.appliesAt) {
    const next = {
      ...config.state,
      light: config.state.transition.to,
      transition: null,
    };
    const saved = await updateConfig(next);
    return saved.config.state;
  }

  return config.state;
}

/** Public read: gameplay config + state + game metadata (no per-team data).
 *  When `teamId` is supplied, also returns that team's own result row so a
 *  player page refresh/reconnect restores its true status (PLAYING/DQ/WINNER). */
export async function getRlglPublicState(teamId = null) {
  const row = await getRlglRow();
  const config = normalizeConfig(row.config);
  const state = await getRlglState();
  const result = teamId ? ((await getResult(row.game_id, teamId)) ?? null) : undefined;
  return {
    gameId: String(row.game_id),
    name: row.name,
    status: row.status,
    countdownSeconds: config.countdownSeconds,
    problem: config.problem ?? null,
    state,
    ...(result ? { result } : {}),
  };
}

// ---------------------------------------------------------------------------
// Transitions (server-authoritative countdown)
// ---------------------------------------------------------------------------

/**
 * Schedule a light transition. Only ADMIN/DEV call this (route + socket guard).
 * - Rejects when a transition is already pending (rapid clicks are no-ops).
 * - Rejects unless the game is ACTIVE and the light is GREEN/RED.
 * - Persists the deadline FIRST, then arms the in-process timer, then returns
 *   so the controller broadcasts only after the DB write succeeded.
 * Returns { state, scheduled: boolean, reason? }.
 */
export async function scheduleTransition(desiredLight) {
  const row = await getRlglRow();
  const config = normalizeConfig(row.config);

  if (!LIGHTS.includes(desiredLight)) {
    throw ApiError.badRequest(`Light must be one of: ${LIGHTS.join(', ')}`, 'VALIDATION_ERROR');
  }
  if (config.state.gameStatus !== 'ACTIVE') {
    return { state: config.state, scheduled: false, reason: 'GAME_NOT_ACTIVE' };
  }
  if (config.state.transition) {
    return { state: config.state, scheduled: false, reason: 'TRANSITION_PENDING' };
  }
  if (config.state.light === desiredLight) {
    return { state: config.state, scheduled: false, reason: 'ALREADY_IN_STATE' };
  }

  const countdownMs = Math.max(1, Number(config.countdownSeconds) || 3) * 1000;
  const appliesAt = Date.now() + countdownMs;

  const next = {
    ...config.state,
    transition: { to: desiredLight, appliesAt },
  };
  const saved = await updateConfig(next);

  armTimer(saved.game.game_id, saved.config.state.transition);
  return { state: saved.config.state, scheduled: true };
}

/**
 * Apply a due transition. Runs from the timer OR from a healing read. Only one
 * caller wins: the timer clears the stored deadline, so a second apply becomes
 * a no-op.
 */
export async function applyTransition(gameId, appliesAt) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT config FROM games WHERE game_id = $1 FOR UPDATE', [
      gameId,
    ]);
    const config = normalizeConfig(rows[0]?.config);
    const t = config.state.transition;

    if (!t || t.appliesAt !== appliesAt) {
      await client.query('ROLLBACK');
      return null; // stale/dead — someone else applied it
    }
    if (config.state.gameStatus !== 'ACTIVE') {
      await client.query('ROLLBACK');
      return null;
    }

    const next = {
      ...config.state,
      light: t.to,
      transition: null,
    };
    await client.query(
      `UPDATE games SET config = $1, updated_at = now() WHERE game_id = $2`,
      [buildConfig(config, next), gameId]
    );
    await client.query('COMMIT');
    return next;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Process-local scheduling; cleared on successful apply. */
function armTimer(gameId, transition) {
  const delay = Math.max(0, transition.appliesAt - Date.now());
  const existing = schedulers.get(gameId);
  if (existing) clearTimeout(existing);

  if (delay === 0) {
    // Deadline already reached — apply immediately (still broadcast so every
    // client converges on the authoritative flip right away).
    applyTransition(gameId, transition.appliesAt)
      .then((state) => {
        if (state) broadcastState(gameId, state);
      })
      .catch((err) => {
        console.error(`[rlgl] Immediate apply failed for game ${gameId}:`, err.message);
      });
    return;
  }

  const timer = setTimeout(() => {
    schedulers.delete(gameId);
    applyTransition(gameId, transition.appliesAt)
      .then((state) => {
        // Only broadcast when this timer actually applied the transition.
        if (state) broadcastState(gameId, state);
      })
      .catch((err) => {
        // Row may have vanished (test reset / game deleted) — the persisted
        // deadline heals on the next state read, so this is safe to log only.
        console.error(`[rlgl] Apply transition failed for game ${gameId}:`, err.message);
      });
  }, delay);
  schedulers.set(gameId, timer);
}

/**
 * Boot/prune: cancel stale in-process timers and re-arm any persisted deadline
 * that is still in the future (heals a server restart mid-countdown). Called
 * from server startup.
 */
export async function pruneRlglTimers() {
  for (const timer of schedulers.values()) clearTimeout(timer);
  schedulers.clear();

  const row = await getRlglRow();
  const config = normalizeConfig(row.config);
  const t = config.state.transition;
  if (!t) return;

  if (Date.now() >= t.appliesAt) {
    // Heal: deadline passed while we were down.
    const state = await applyTransition(row.game_id, t.appliesAt);
    if (state) broadcastState(row.game_id, state);
  } else {
    armTimer(row.game_id, t);
  }
}

// ---------------------------------------------------------------------------
// Broadcast helper (server -> all clients + admin)
// ---------------------------------------------------------------------------

let ioRef = null;

/** Called once from server startup with the Socket.IO instance. */
export function bindRlglIo(io) {
  ioRef = io;
}

export function getRlglIo() {
  return ioRef;
}

export async function broadcastState(gameId, state) {
  const io = ioRef;
  if (!io) return;
  io.emit('rlgl:state', { gameId: String(gameId), state });
}

// ---------------------------------------------------------------------------
// Game lifecycle helpers (admin-controlled round start/end)
// ---------------------------------------------------------------------------

/** Cancel any armed timer for a game (round end/status change, boot prune). */
function clearTimer(gameId) {
  const existing = schedulers.get(gameId);
  if (existing) {
    clearTimeout(existing);
    schedulers.delete(gameId);
  }
}

/** Set gameStatus (WAITING/ACTIVE/COMPLETED). Clears any pending transition. */
export async function setGameStatus(status) {
  const row = await getRlglRow();
  const config = normalizeConfig(row.config);
  const next = { ...config.state, gameStatus: status, transition: null };
  const saved = await updateConfig(next);
  // A status change (END ROUND / START ROUND) supersedes any armed countdown —
  // cancel the in-process timer so it cannot fire against the new round.
  clearTimer(row.game_id);
  return saved.config.state;
}

/**
 * Start (or restart) the round. Admin-only (route + socket guard).
 * - Forces gameStatus ACTIVE, light GREEN, clears any pending transition.
 * - Resets every team's RLGL result back to PLAYING so the previous round's
 *   winners/disqualifications never leak into the new round.
 * Returns { state, resetCount }.
 */
export async function startRound() {
  const row = await getRlglRow();
  const config = normalizeConfig(row.config);
  const next = {
    ...config.state,
    gameStatus: 'ACTIVE',
    light: 'GREEN',
    transition: null,
  };
  const saved = await updateConfig(next);
  // A restart supersedes any armed countdown from the previous round.
  clearTimer(row.game_id);
  const { resetCount } = await resetRlglResults();
  return { state: saved.config.state, resetCount };
}

/**
 * End the round. Admin-only. Marks the game COMPLETED and clears any pending
 * transition. After this, typing violations and submits are rejected by the
 * service (GAME_NOT_ACTIVE), and every client shows the ended state.
 */
export async function endRound() {
  const state = await setGameStatus('COMPLETED');
  return { state };
}

/** Reset every team's RLGL result back to PLAYING (round start / replay). */
export async function resetRlglResults() {
  const { rows } = await query(
    `UPDATE game_results gr
     SET rank = NULL, score = NULL, time_seconds = NULL,
         status = 'PLAYING', updated_at = now()
     FROM games g
     WHERE g.route = $1 AND gr.game_id = g.game_id`,
    [RLGL_ROUTE]
  );
  return { resetCount: rows.length };
}

// ---------------------------------------------------------------------------
// Per-team results (disqualification, winner) — reused game_results model
// ---------------------------------------------------------------------------

async function getResult(gameId, teamId) {
  const { rows } = await query(
    `SELECT result_id, game_id, team_id, rank, score, time_seconds, status
     FROM game_results WHERE game_id = $1 AND team_id = $2`,
    [gameId, teamId]
  );
  return normalizeResult(rows[0] || null);
}

async function upsertResult(gameId, teamId, fields) {
  const { rows } = await query(
    `INSERT INTO game_results (game_id, team_id, rank, score, time_seconds, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (game_id, team_id) DO UPDATE SET
       rank = EXCLUDED.rank,
       score = EXCLUDED.score,
       time_seconds = EXCLUDED.time_seconds,
       status = EXCLUDED.status,
       updated_at = now()
     RETURNING result_id, game_id, team_id, rank, score, time_seconds, status,
               created_at, updated_at`,
    [gameId, teamId, fields.rank ?? null, fields.score ?? null, fields.time_seconds ?? null, fields.status ?? 'PLAYING']
  );
  return normalizeResult(rows[0]);
}

/** Emit a team-scoped result event (only that team's room hears it). */
function emitTeamResult(gameId, teamId, result) {
  const io = ioRef;
  if (!io) return;
  io.to(`team:${teamId}`).emit('rlgl:result', {
    type: 'result',
    gameId: String(gameId),
    result,
  });
  // Mirrors the existing per-team results event consumed by dashboards.
  io.to(`team:${teamId}`).emit('game:updated', {
    type: 'result',
    gameId: String(gameId),
    result,
  });
  // RLGL control panels (admin room) refresh their roster from rlgl:result, so
  // they hear every result change (winner, admin/violation disqualify, reinstate)
  // and update the ACTIVE/DISQUALIFIED/FINISHED columns live.
  io.to('admin').emit('rlgl:result', {
    type: 'result',
    gameId: String(gameId),
    result,
  });
}

/** Admin: disqualify one team (persist, then broadcast to that team). */
export async function disqualifyTeam(teamId) {
  const row = await getRlglRow();
  const result = await upsertResult(row.game_id, teamId, { status: 'DISQUALIFIED' });
  emitTeamResult(row.game_id, teamId, result);
  return result;
}

/** Admin: disqualify every currently active (PLAYING/QUALIFIED) team. */
export async function disqualifyAllTeams() {
  const row = await getRlglRow();
  const { rows } = await query(
    `UPDATE game_results gr
     SET status = 'DISQUALIFIED', updated_at = now()
     FROM games g
     WHERE g.route = $1 AND gr.game_id = g.game_id
       AND gr.status IN ('PLAYING', 'QUALIFIED')
     RETURNING gr.result_id, gr.game_id, gr.team_id, gr.rank, gr.score,
               gr.time_seconds, gr.status, gr.created_at, gr.updated_at`,
    [RLGL_ROUTE]
  );
  const results = rows.map(normalizeResult);
  for (const result of results) emitTeamResult(row.game_id, result.team_id, result);
  return { gameId: String(row.game_id), disqualifiedCount: results.length };
}

/** Admin: reinstate a team to PLAYING (undo a mistaken disqualification). */
export async function reinstateTeam(teamId) {
  const row = await getRlglRow();
  const result = await upsertResult(row.game_id, teamId, { status: 'PLAYING' });
  emitTeamResult(row.game_id, teamId, result);
  return result;
}

/**
 * Report a RED-light typing violation for a team (server-authoritative).
 *
 * Called from the rlgl:violation socket handler and the POST /violation route
 * — both authenticate the caller, so `teamId` always comes from the JWT, never
 * from a client payload. Runs inside a transaction with the RLGL row locked
 * (`SELECT ... FOR UPDATE`): the authoritative light is re-read under the lock
 * and the disqualification is written exactly once, so two concurrent reports
 * (e.g. two participants of the same team typing at the same instant) cannot
 * double-record or double-broadcast. Typing during a pending countdown is legal
 * because the OLD light is still authoritative until the deadline passes.
 *
 * Returns { ok, reason?, result? }.
 */
export async function reportRedLightViolation(teamId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT game_id, config FROM games WHERE route = $1 FOR UPDATE`,
      [RLGL_ROUTE]
    );
    const row = rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      throw ApiError.notFound('RLGL game not found');
    }
    const config = normalizeConfig(row.config);
    const state = config.state;

    // Healing read under the lock: if a persisted deadline already passed,
    // apply it before judging (keeps the light authoritative even when a
    // violation arrives exactly at the flip boundary).
    let current = state;
    if (state.transition && Date.now() >= state.transition.appliesAt) {
      const healed = {
        ...state,
        light: state.transition.to,
        transition: null,
      };
      await client.query('UPDATE games SET config = $1, updated_at = now() WHERE game_id = $2', [
        JSON.stringify({ ...config, state: { ...healed, updatedAt: new Date().toISOString() } }),
        row.game_id,
      ]);
      current = healed;
    }

    if (current.gameStatus !== 'ACTIVE') {
      await client.query('COMMIT');
      return { ok: false, reason: 'GAME_NOT_ACTIVE' };
    }
    if (current.light !== 'RED') {
      await client.query('COMMIT');
      return { ok: false, reason: 'NOT_RED' }; // countdown still on the old light
    }

    // Idempotency: only PLAYING/QUALIFIED/absent rows may be disqualified.
    const { rows: existing } = await client.query(
      `SELECT result_id, game_id, team_id, rank, score, time_seconds, status,
              created_at, updated_at
       FROM game_results WHERE game_id = $1 AND team_id = $2 FOR UPDATE`,
      [row.game_id, teamId]
    );
    const prev = normalizeResult(existing[0] || null);
    if (prev?.status === 'DISQUALIFIED') {
      await client.query('COMMIT');
      return { ok: false, reason: 'ALREADY_DISQUALIFIED', result: prev };
    }
    if (prev?.status === 'WINNER') {
      await client.query('COMMIT');
      return { ok: false, reason: 'TEAM_ALREADY_FINISHED', result: prev };
    }

    const { rows: upserted } = await client.query(
      `INSERT INTO game_results (game_id, team_id, rank, score, time_seconds, status)
       VALUES ($1, $2, NULL, NULL, NULL, 'DISQUALIFIED')
       ON CONFLICT (game_id, team_id) DO UPDATE SET
         status = 'DISQUALIFIED', updated_at = now()
       RETURNING result_id, game_id, team_id, rank, score, time_seconds, status,
                 created_at, updated_at`,
      [row.game_id, teamId]
    );
    await client.query('COMMIT');

    const result = normalizeResult(upserted[0]);
    emitTeamResult(row.game_id, teamId, result);
    return { ok: true, result };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Submission — in-process test evaluation (no fake verdicts)
// ---------------------------------------------------------------------------

/**
 * Evaluate a submitted solution against the stored problem's test cases in a
 * Node vm context. Returns the same per-test shape the old client runner
 * produced, but computed server-side.
 */
export function runProblemTestCases(problem, code) {
  const fnName = problem.fnName;
  const script = new vm.Script(`"use strict";\n${code}\n;globalThis.__fn = ${fnName};`, {
    timeout: 1000,
  });
  const sandbox = { console };
  vm.createContext(sandbox);
  script.runInContext(sandbox, { timeout: 1000 });
  const userFn = sandbox.__fn;
  if (typeof userFn !== 'function') {
    throw ApiError.badRequest(`Solution must define function ${fnName}`, 'INVALID_SOLUTION');
  }

  return (problem.testCases ?? []).map((tc, idx) => {
    try {
      const args = (tc.input ?? []).map((arg) => JSON.parse(arg));
      const actual = userFn(...args);
      const expected = JSON.parse(tc.expected);
      const passed = JSON.stringify(actual) === JSON.stringify(expected);
      return {
        id: idx + 1,
        input: (tc.input ?? []).join(', '),
        expected: tc.expected,
        actual: JSON.stringify(actual),
        passed,
      };
    } catch (err) {
      return {
        id: idx + 1,
        input: (tc.input ?? []).join(', '),
        expected: tc.expected,
        actual: `Error: ${err.message}`,
        passed: false,
      };
    }
  });
}

/**
 * Handle a team's submit during an ACTIVE game.
 * - Team identity comes from the JWT (req.user), never from the body.
 * - Submitting is a deliberate click, NOT typing, so it is allowed in BOTH
 *   GREEN and RED while the round is ACTIVE. The only rejections are an
 *   inactive round, a missing problem, and an already DISQUALIFIED/WINNER team.
 * - On full pass: upserts WINNER (score 100, time_seconds = elapsed since the
 *   round reached ACTIVE) and emits to the team room. The existing-row check
 *   and the WINNER upsert run under a row lock so two concurrent submits from
 *   the same team cannot both claim the win.
 * Returns { passed, results, result, state }.
 */
export async function submitSolution({ teamId, code }) {
  const row = await getRlglRow();
  const config = normalizeConfig(row.config);

  if (config.state.gameStatus !== 'ACTIVE') {
    throw ApiError.conflict('Game is not active', 'GAME_NOT_ACTIVE');
  }
  if (!config.problem) {
    throw ApiError.conflict('No problem configured for this round', 'NO_PROBLEM');
  }

  const results = runProblemTestCases(config.problem, code);
  const passedCount = results.filter((r) => r.passed).length;
  const allPassed = passedCount === results.length && results.length > 0;

  // A failed submit changes nothing — result stays null so the client knows no
  // row was written by THIS attempt.
  let result = null;
  if (allPassed) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const { rows: existing } = await client.query(
        `SELECT status FROM game_results WHERE game_id = $1 AND team_id = $2 FOR UPDATE`,
        [row.game_id, teamId]
      );
      if (existing[0]?.status === 'DISQUALIFIED') {
        await client.query('ROLLBACK');
        throw ApiError.conflict('Team is disqualified from this round', 'TEAM_DISQUALIFIED');
      }
      if (existing[0]?.status === 'WINNER') {
        await client.query('ROLLBACK');
        throw ApiError.conflict('Team has already finished this round', 'TEAM_ALREADY_FINISHED');
      }

      // Elapsed time is measured from when the current round became ACTIVE.
      // Read from the already-loaded config (never re-query inside the open
      // transaction — the RLGL row is locked by this client).
      const startedAt = new Date(config.state.updatedAt).getTime();
      const elapsedSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));

      const { rows: upserted } = await client.query(
        `INSERT INTO game_results (game_id, team_id, rank, score, time_seconds, status)
         VALUES ($1, $2, NULL, 100, $3, 'WINNER')
         ON CONFLICT (game_id, team_id) DO UPDATE SET
           rank = EXCLUDED.rank,
           score = EXCLUDED.score,
           time_seconds = EXCLUDED.time_seconds,
           status = EXCLUDED.status,
           updated_at = now()
         RETURNING result_id, game_id, team_id, rank, score, time_seconds, status,
                   created_at, updated_at`,
        [row.game_id, teamId, elapsedSeconds]
      );
      await client.query('COMMIT');
      result = normalizeResult(upserted[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    emitTeamResult(row.game_id, teamId, result);
  }

  const state = await getRlglState();
  return {
    passed: allPassed,
    passedCount,
    total: results.length,
    results,
    result,
    state,
  };
}
