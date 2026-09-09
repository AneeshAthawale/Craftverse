/**
 * RLGL server-authoritative state tests.
 *
 * Covers:
 *  - GET /api/games/rlgl/state returns the seeded problem + light state
 *  - POST /transition schedules a pending transition (light unchanged until
 *    the deadline, then flips) — the core server-countdown requirement
 *  - POST /transition as PARTICIPANT is 403
 *  - double-click protection: second transition while pending is a no-op
 *  - refresh/join mid-countdown: GET state returns the pending transition
 *    with the same deadline (not a reset)
 *  - Socket.IO: admin rlgl:transition schedules + broadcasts rlgl:state, and a
 *    second rlgl:state arrives at the deadline with the flipped light
 *  - Socket.IO: no state broadcast when the schedule is a no-op
 *  - Submit during RED is 409
 *  - Submit during GREEN with a correct solution upserts WINNER + emits
 *    rlgl:result to the team room
 *  - A disqualified team cannot submit (409)
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { io as ioc } from 'socket.io-client';
import {
  resetSchema,
  seedUsers,
  setTeamRegistered,
  signToken,
  FIXTURES,
  createApp,
  pool,
} from './helpers.js';

let server;
let httpOrigin;
let baseUrl;

/** A second team's PARTICIPANT so we can exercise per-team results. */
const P2 = { user_id: 5, email: 'p002@test.local', role: 'PARTICIPANT', team_id: 'T02', participant_id: 2 };

/** Shared RLGL problem + authoritative state (mirrors the dev seed). */
const PROBLEM = {
  id: 'rlgl_round_problem',
  title: 'Reverse Words',
  domain: 'CYBERSECURITY',
  difficulty: 'Easy',
  description: 'Reverse the order of words in a string.',
  starterCode: 'function reverseWords(str) {\n  return str.trim().split(/\\s+/).reverse().join(" ");\n}',
  fnName: 'reverseWords',
  testCases: [
    { input: ['"the sky is blue"'], expected: '"blue is sky the"' },
    { input: ['"  hello world  "'], expected: '"world hello"' },
    { input: ['"a good   example"'], expected: '"example good a"' },
  ],
};

function makeConfig(overrides = {}) {
  return {
    problem: PROBLEM,
    countdownSeconds: 3,
    state: {
      light: 'GREEN',
      gameStatus: 'ACTIVE',
      transition: null,
      updatedAt: new Date().toISOString(),
      ...overrides,
    },
  };
}

async function seedRlgl(config) {
  await pool.query(
    `INSERT INTO games (name, description, status, route, config) VALUES
     ('Red Light Green Light', 'Code during GREEN. Stop during RED.', 'LIVE', 'rlgl', $1)
     ON CONFLICT (route) DO UPDATE SET config = EXCLUDED.config`,
    [JSON.stringify(config)]
  );
  const { rows } = await pool.query(`SELECT game_id FROM games WHERE route = 'rlgl'`);
  return rows[0].game_id;
}

/** Seed an ACTIVE game with the given current light + optional pending transition. */
async function seedRlglWithState({ light = 'GREEN', transition = null } = {}) {
  const config = makeConfig({
    light,
    ...(transition ? { transition } : { transition: null }),
  });
  return seedRlgl(config);
}

async function seedResult(gameId, teamId, status) {
  await pool.query(
    `INSERT INTO game_results (game_id, team_id, status) VALUES ($1, $2, $3)
     ON CONFLICT (game_id, team_id) DO UPDATE SET status = EXCLUDED.status`,
    [gameId, teamId, status]
  );
}

before(async () => {
  const built = createApp();
  server = built.server;
  await new Promise((resolve) => server.listen(0, resolve));
  httpOrigin = `http://127.0.0.1:${server.address().port}`;
  baseUrl = `${httpOrigin}/api`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

beforeEach(async () => {
  await resetSchema();
  await seedUsers();
  // T01's participant submits/violates in these tests, so its team must be
  // checked in (REGISTERED) — event-day features require verification.
  await setTeamRegistered('T01');
  // Second team so submit/result tests can target a distinct team socket.
  await pool.query(
    `INSERT INTO teams (team_id, team_name, registration_token, registration_status)
     VALUES ('T02', 'Second Team', 'cv-reg-test-token-2', 'REGISTERED')
     ON CONFLICT (team_id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO participants (participant_id, name, email, team_id)
     VALUES (2, 'Second Participant', 'p002@test.local', 'T02')
     ON CONFLICT (participant_id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO users (user_id, email, password_hash, role, participant_id, team_id)
     VALUES ($1, $2, 'unused-test-hash', $3, $4, $5)
     ON CONFLICT (user_id) DO NOTHING`,
    [P2.user_id, P2.email, P2.role, P2.participant_id, P2.team_id]
  );
});

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

async function getState(role) {
  const res = await fetch(`${baseUrl}/games/rlgl/state`, {
    headers: auth(signToken(FIXTURES[role])),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function postTransition(role, to) {
  const res = await fetch(`${baseUrl}/games/rlgl/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(signToken(FIXTURES[role])) },
    body: JSON.stringify({ to }),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function postSubmit(role, code) {
  const res = await fetch(`${baseUrl}/games/rlgl/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(signToken(FIXTURES[role])) },
    body: JSON.stringify({ code }),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

function connectSocket(role) {
  return new Promise((resolve, reject) => {
    const socket = ioc(httpOrigin, {
      transports: ['websocket'],
      auth: { token: signToken(FIXTURES[role]) },
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

/** Connect a socket with an arbitrary fixture user (e.g. a second team). */
function connectSocketAs(userFixture) {
  return new Promise((resolve, reject) => {
    const socket = ioc(httpOrigin, {
      transports: ['websocket'],
      auth: { token: signToken(userFixture) },
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function once(socket, event, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------- state API ----

test('GET /api/games/rlgl/state returns seeded problem + GREEN light for any role', async () => {
  const gameId = await seedRlgl(makeConfig());

  for (const role of ['admin', 'participant']) {
    const { status, data } = await getState(role);
    assert.equal(status, 200);
    assert.equal(String(data.gameId), String(gameId));
    assert.equal(data.state.light, 'GREEN');
    assert.equal(data.state.gameStatus, 'ACTIVE');
    assert.equal(data.state.transition, null);
    assert.equal(data.countdownSeconds, 3);
    assert.equal(data.problem.fnName, 'reverseWords');
    assert.equal(data.problem.testCases.length, 3);
  }
});

test('GET /api/games/rlgl/state requires authentication', async () => {
  await seedRlgl(makeConfig());
  const res = await fetch(`${baseUrl}/games/rlgl/state`);
  assert.equal(res.status, 401);
});

// ------------------------------------------------------ transitions ------

test('ADMIN transition schedules a pending transition; light flips only after the deadline', async () => {
  await seedRlgl(makeConfig());
  const t0 = Date.now();

  const sched = await postTransition('admin', 'RED');
  assert.equal(sched.status, 200);
  assert.equal(sched.data.scheduled, true);
  assert.equal(sched.data.state.light, 'GREEN'); // unchanged during countdown
  assert.ok(sched.data.state.transition);
  assert.equal(sched.data.state.transition.to, 'RED');
  const appliesAt = new Date(sched.data.state.transition.appliesAt).getTime();
  assert.ok(appliesAt - t0 >= 2500 && appliesAt - t0 <= 3500, `appliesAt delta ${appliesAt - t0}`);

  // Immediately after scheduling, the authoritative state still says GREEN.
  const immediate = await getState('participant');
  assert.equal(immediate.data.state.light, 'GREEN');
  assert.equal(immediate.data.state.transition.to, 'RED');

  // Wait past the deadline: the server applies RED on its own.
  await sleep(3300);
  const after = await getState('participant');
  assert.equal(after.data.state.light, 'RED');
  assert.equal(after.data.state.transition, null);
});

test('PARTICIPANT cannot schedule a transition (403)', async () => {
  await seedRlgl(makeConfig());
  for (const role of ['participant']) {
    const { status } = await postTransition(role, 'RED');
    assert.equal(status, 403);
  }
});

test('repeated admin clicks while a transition is pending are no-ops', async () => {
  await seedRlgl(makeConfig());
  const first = await postTransition('admin', 'RED');
  assert.equal(first.data.scheduled, true);
  const firstAppliesAt = first.data.state.transition.appliesAt;

  const second = await postTransition('admin', 'GREEN'); // opposite target — must be ignored
  assert.equal(second.status, 200);
  assert.equal(second.data.scheduled, false);
  assert.equal(second.data.reason, 'TRANSITION_PENDING');
  assert.equal(second.data.state.transition.to, 'RED'); // still the original target
  assert.equal(second.data.state.transition.appliesAt, firstAppliesAt);

  await sleep(3300);
  const after = await getState('participant');
  assert.equal(after.data.state.light, 'RED');
});

test('a refresh/join mid-countdown sees the pending transition with the same deadline', async () => {
  await seedRlgl(makeConfig());
  const sched = await postTransition('admin', 'RED');
  const appliesAt = new Date(sched.data.state.transition.appliesAt).getTime();

  // A "fresh" client (new request) ~1s into the countdown must see the pending
  // transition still pointed at the original deadline — not a reset.
  await sleep(1000);
  const fresh = await getState('participant');
  assert.equal(fresh.data.state.light, 'GREEN');
  assert.equal(fresh.data.state.transition.to, 'RED');
  const freshAppliesAt = new Date(fresh.data.state.transition.appliesAt).getTime();
  assert.equal(freshAppliesAt, appliesAt);
  assert.ok(freshAppliesAt - Date.now() <= 2200);
});

test('a server restart mid-countdown re-arms a still-future deadline from the DB', async () => {
  // Schedule normally (the in-process timer is armed), then fork a child that
  // boots a fresh app against the SAME database with boot-prune enabled — the
  // way the real server restarts. The child must re-arm from the persisted
  // appliesAt and flip RED at the original deadline (not reset it).
  await seedRlgl(makeConfig());
  const sched = await postTransition('admin', 'RED');
  const appliesAt = new Date(sched.data.state.transition.appliesAt).getTime();
  const remaining = Math.max(0, appliesAt - Date.now());
  assert.ok(remaining > 800, `expected a live countdown, got ${remaining}ms remaining`);

  const child = await new Promise((resolve, reject) => {
    const childProcess = fork(
      new URL('../scripts/boot-prune-child.js', import.meta.url),
      [],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }
    );
    let stdout = '';
    let stderr = '';
    childProcess.stdout.on('data', (d) => { stdout += d; });
    childProcess.stderr.on('data', (d) => { stderr += d; });
    let settled = false;
    childProcess.on('message', (msg) => {
      if (settled) return;
      settled = true;
      resolve({ childProcess, stdout, stderr, msg });
    });
    childProcess.on('error', (err) => {
      if (!settled) reject(err);
    });
    childProcess.on('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`child exited early (code ${code}): ${stdout}\n${stderr}`));
      }
    });
  });

  const { childProcess, msg } = child;
  assert.equal(msg.pruned, true, `child prune failed: ${msg.error ?? ''}`);

  // The child's prune must NOT have applied the transition while it was still
  // in the future — it should still be pending in the DB at this moment.
  const mid = await getState('participant');
  assert.equal(mid.data.state.light, 'GREEN');
  assert.equal(mid.data.state.transition.to, 'RED');

  // Wait out the remainder: the original server's own timer OR the child's
  // re-armed timer applies RED.
  await sleep(3000);
  const after = await getState('participant');
  assert.equal(after.data.state.light, 'RED');
  assert.equal(after.data.state.transition, null);

  childProcess.kill();
  await new Promise((r) => setTimeout(r, 100));
});

test('transition while the game is not ACTIVE is a no-op', async () => {
  await seedRlgl(makeConfig({ gameStatus: 'COMPLETED' }));
  const { status, data } = await postTransition('admin', 'RED');
  assert.equal(status, 200);
  assert.equal(data.scheduled, false);
  assert.equal(data.reason, 'GAME_NOT_ACTIVE');
});

test('transition to the current light is a no-op', async () => {
  await seedRlgl(makeConfig());
  const { data } = await postTransition('admin', 'GREEN');
  assert.equal(data.scheduled, false);
  assert.equal(data.reason, 'ALREADY_IN_STATE');
});

test('invalid transition target is rejected with 400', async () => {
  await seedRlgl(makeConfig());
  const { status } = await postTransition('admin', 'PURPLE');
  assert.equal(status, 400);
});

// ----------------------------------------- recovery: restart mid-countdown ----

test('a pending transition whose deadline passed while the process was down is applied on the next state read', async () => {
  // Simulate a server restart mid-countdown: the deadline has already passed
  // but nothing applied it (the in-memory timer is gone). The next state read
  // must heal the state to RED — not reset it.
  const past = Date.now() - 1000;
  await seedRlglWithState({ light: 'GREEN', transition: { to: 'RED', appliesAt: past } });

  const { status, data } = await getState('participant');
  assert.equal(status, 200);
  assert.equal(data.state.light, 'RED');
  assert.equal(data.state.transition, null);

  // The healed state is persisted, not just returned.
  const { rows } = await pool.query(`SELECT config FROM games WHERE route = 'rlgl'`);
  assert.equal(rows[0].config.state.light, 'RED');
  assert.equal(rows[0].config.state.transition, null);
});

// ----------------------------------------------------------- sockets ----

test('socket: admin rlgl:transition schedules, broadcasts rlgl:state now and flips at the deadline', async () => {
  await seedRlgl(makeConfig());
  const [participantSocket, teamSocket, adminSocket] = await Promise.all([
    connectSocket('participant'),
    connectSocket('participant'),
    connectSocket('admin'),
  ]);

  try {
    // Emit through the admin socket exactly like the admin panel does.
    const p1 = once(participantSocket, 'rlgl:state');
    const t1 = once(teamSocket, 'rlgl:state');
    const a1 = once(adminSocket, 'rlgl:state');
    const ackPromise = new Promise((resolve) => {
      adminSocket.emit('rlgl:transition', { to: 'RED' }, resolve);
    });

    const ack = await ackPromise;
    assert.equal(ack.ok, true);

    const [pEvt, tEvt, aEvt] = await Promise.all([p1, t1, a1]);
    for (const evt of [pEvt, tEvt, aEvt]) {
      assert.equal(evt.state.light, 'GREEN'); // scheduled, not yet applied
      assert.equal(evt.state.transition.to, 'RED');
    }

    // At the deadline (~3s later), a second rlgl:state arrives with the flipped
    // light. Wait longer than the countdown so the event has time to land.
    const p2 = once(participantSocket, 'rlgl:state', 5000);
    const evt2 = await p2;
    assert.equal(evt2.state.light, 'RED');
    assert.equal(evt2.state.transition, null);
  } finally {
    [participantSocket, teamSocket, adminSocket].forEach((s) => s.disconnect());
  }
});

test('socket: a no-op transition (pending) does not broadcast', async () => {
  await seedRlgl(makeConfig());
  const [adminSocket, participantSocket] = await Promise.all([
    connectSocket('admin'),
    connectSocket('participant'),
  ]);

  try {
    const firstAck = new Promise((resolve) => {
      adminSocket.emit('rlgl:transition', { to: 'RED' }, resolve);
    });
    assert.equal((await firstAck).ok, true);

    let received = false;
    const onState = () => {
      received = true;
    };
    participantSocket.on('rlgl:state', onState);

    // Wait past the schedule broadcast so only a (wrongful) duplicate broadcast
    // would trip the flag below.
    await sleep(500);

    const secondAck = new Promise((resolve) => {
      adminSocket.emit('rlgl:transition', { to: 'GREEN' }, resolve);
    });
    const ack = await secondAck;
    assert.equal(ack.ok, false);
    assert.equal(ack.reason, 'TRANSITION_PENDING');

    // Reset the flag right before the duplicate so we only measure broadcasts
    // caused by the no-op attempt (a stale deadline timer from an earlier test
    // may have fired during the flush window above).
    received = false;
    await sleep(400);
    assert.equal(received, false);
    participantSocket.off('rlgl:state', onState);
  } finally {
    [adminSocket, participantSocket].forEach((s) => s.disconnect());
  }
});

test('socket: non-admin cannot emit rlgl:transition', async () => {
  await seedRlgl(makeConfig());
  const [teamSocket] = await Promise.all([connectSocket('participant')]);
  try {
    const ack = await new Promise((resolve) => {
      teamSocket.emit('rlgl:transition', { to: 'RED' }, resolve);
    });
    assert.equal(ack.ok, false);
    assert.equal(ack.reason, 'FORBIDDEN');
  } finally {
    teamSocket.disconnect();
  }
});

// ----------------------------------------------------------- submit ------

test('submit during RED LIGHT is allowed and can produce a WINNER (submit is a click, not typing)', async () => {
  const gameId = await seedRlgl(makeConfig({ light: 'RED' }));
  await seedResult(gameId, 'T01', 'PLAYING');

  const { status, data } = await postSubmit('participant', PROBLEM.starterCode);
  assert.equal(status, 200);
  assert.equal(data.passed, true);
  assert.equal(data.result.status, 'WINNER');
  assert.equal(data.result.team_id, 'T01');

  const { rows } = await pool.query(
    'SELECT status FROM game_results WHERE game_id = $1 AND team_id = $2',
    [gameId, 'T01']
  );
  assert.equal(rows[0].status, 'WINNER');
});

test('a WINNER team is not disqualified by a later RED-light violation', async () => {
  const gameId = await seedRlgl(makeConfig({ light: 'RED' }));
  await seedResult(gameId, 'T01', 'WINNER');

  const { status, data } = await postViolation('participant');
  assert.equal(status, 200);
  assert.equal(data.ok, false);
  assert.equal(data.reason, 'TEAM_ALREADY_FINISHED');

  const { rows } = await pool.query(
    'SELECT status FROM game_results WHERE game_id = $1 AND team_id = $2',
    [gameId, 'T01']
  );
  assert.equal(rows[0].status, 'WINNER');
});

test('submit with a correct solution during GREEN upserts WINNER and emits rlgl:result to the team room', async () => {
  const gameId = await seedRlgl(makeConfig());
  await seedResult(gameId, 'T01', 'PLAYING');

  // T01's participant submits; the T01 participant socket must receive rlgl:result.
  const [teamSocket] = await Promise.all([connectSocket('participant')]);
  try {
    const resultPromise = once(teamSocket, 'rlgl:result');
    const { status, data } = await postSubmit('participant', PROBLEM.starterCode);

    assert.equal(status, 200);
    assert.equal(data.passed, true);
    assert.equal(data.passedCount, 3);
    assert.equal(data.total, 3);
    assert.equal(data.result.status, 'WINNER');
    assert.equal(data.result.team_id, 'T01');
    assert.equal(data.result.score, 100);
    assert.equal(typeof data.result.time_seconds, 'number');

    const evt = await resultPromise;
    assert.equal(evt.result.status, 'WINNER');
    assert.equal(evt.result.team_id, 'T01');
  } finally {
    teamSocket.disconnect();
  }
});

test('submit with an incorrect solution does not change the team result', async () => {
  const gameId = await seedRlgl(makeConfig());
  await seedResult(gameId, 'T01', 'PLAYING');

  const badCode = 'function reverseWords(str) {\n  return str;\n}';
  const { status, data } = await postSubmit('participant', badCode);
  assert.equal(status, 200);
  assert.equal(data.passed, false);
  assert.equal(data.result, null);

  const { rows } = await pool.query(
    'SELECT status FROM game_results WHERE game_id = $1 AND team_id = $2',
    [gameId, 'T01']
  );
  assert.equal(rows[0].status, 'PLAYING');
});

test('submit as PARTICIPANT uses the JWT team identity', async () => {
  const gameId = await seedRlgl(makeConfig());
  await seedResult(gameId, 'T01', 'PLAYING');

  // PARTICIPANT belongs to T01 via the JWT claim — no team id in the body.
  const { status, data } = await postSubmit('participant', PROBLEM.starterCode);
  assert.equal(status, 200);
  assert.equal(data.result.team_id, 'T01');
});

test('a disqualified team cannot submit (409)', async () => {
  const gameId = await seedRlgl(makeConfig());
  await seedResult(gameId, 'T01', 'DISQUALIFIED');

  const { status, data } = await postSubmit('participant', PROBLEM.starterCode);
  assert.equal(status, 409);
  assert.equal(data.error.code, 'TEAM_DISQUALIFIED');
});

test('a team whose result is not yet present can submit and become WINNER', async () => {
  // No game_results row for T02 — the submit must still work and create one.
  const gameId = await seedRlgl(makeConfig());

  const [t02Socket] = await Promise.all([connectSocketAs(P2)]);
  try {
    const resultPromise = once(t02Socket, 'rlgl:result');
    const res = await fetch(`${baseUrl}/games/rlgl/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(signToken(P2)) },
      body: JSON.stringify({ code: PROBLEM.starterCode }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.passed, true);
    assert.equal(data.result.team_id, 'T02');
    assert.equal(data.result.status, 'WINNER');

    const evt = await resultPromise;
    assert.equal(evt.result.team_id, 'T02');
    assert.equal(evt.result.status, 'WINNER');
  } finally {
    t02Socket.disconnect();
  }
  assert.ok(gameId);
});

test('submit during a pending countdown is judged under the CURRENT light', async () => {
  // Pending RED: light is still GREEN, so a submit is legal and can pass.
  const gameId = await seedRlgl(makeConfig());
  await seedResult(gameId, 'T01', 'PLAYING');
  await postTransition('admin', 'RED'); // countdown running, light still GREEN

  const { status, data } = await postSubmit('participant', PROBLEM.starterCode);
  assert.equal(status, 200);
  assert.equal(data.passed, true);

  await sleep(3300);
  const after = await getState('participant');
  assert.equal(after.data.state.light, 'RED');
});

// ------------------------------------------------------- violation ------

/** POST /api/games/rlgl/violation as a given role. */
async function postViolation(role) {
  const res = await fetch(`${baseUrl}/games/rlgl/violation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(signToken(FIXTURES[role])) },
    body: JSON.stringify({}),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

test('violation during RED disqualifies the team and emits rlgl:result to the team room', async () => {
  const gameId = await seedRlgl(makeConfig({ light: 'RED' }));
  await seedResult(gameId, 'T01', 'PLAYING');

  const [teamSocket, adminSocket] = await Promise.all([
    connectSocket('participant'),
    connectSocket('admin'),
  ]);
  try {
    // Attach both listeners BEFORE the emit — the broadcasts land synchronously
    // inside reportRedLightViolation, before the ack resolves.
    const resultPromise = once(teamSocket, 'rlgl:result');
    const adminResultPromise = once(adminSocket, 'rlgl:result');

    const ack = await new Promise((resolve) => {
      teamSocket.emit('rlgl:violation', {}, resolve);
    });
    assert.equal(ack.ok, true);
    assert.equal(ack.reason, null);
    assert.equal(ack.result.status, 'DISQUALIFIED');
    assert.equal(ack.result.team_id, 'T01');

    const evt = await resultPromise;
    assert.equal(evt.result.status, 'DISQUALIFIED');
    assert.equal(evt.result.team_id, 'T01');

    // The disqualification is authoritative (persisted), not just client-side.
    const { rows } = await pool.query(
      'SELECT status FROM game_results WHERE game_id = $1 AND team_id = $2',
      [gameId, 'T01']
    );
    assert.equal(rows[0].status, 'DISQUALIFIED');

    // The admin panel roster refreshes via rlgl:result in the admin room.
    const adminEvt = await adminResultPromise;
    assert.equal(adminEvt.result.status, 'DISQUALIFIED');
    assert.equal(adminEvt.result.team_id, 'T01');
  } finally {
    [teamSocket, adminSocket].forEach((s) => s.disconnect());
  }
});

test('violation while the light is GREEN is a no-op (countdown typing is legal)', async () => {
  // Pending RED: the light is still GREEN until the deadline passes, so typing
  // during the countdown must NOT disqualify.
  const gameId = await seedRlgl(makeConfig());
  await seedResult(gameId, 'T01', 'PLAYING');
  await postTransition('admin', 'RED'); // 3s countdown, light still GREEN

  const { status, data } = await postViolation('participant');
  assert.equal(status, 200);
  assert.equal(data.ok, false);
  assert.equal(data.reason, 'NOT_RED');

  const { rows } = await pool.query(
    'SELECT status FROM game_results WHERE game_id = $1 AND team_id = $2',
    [gameId, 'T01']
  );
  assert.equal(rows[0].status, 'PLAYING');
});

test('violation when the round is not ACTIVE is a no-op', async () => {
  await seedRlgl(makeConfig({ gameStatus: 'COMPLETED', light: 'RED' }));
  const { status, data } = await postViolation('participant');
  assert.equal(status, 200);
  assert.equal(data.ok, false);
  assert.equal(data.reason, 'GAME_NOT_ACTIVE');
});

test('a second violation for an already-disqualified team is an idempotent no-op', async () => {
  const gameId = await seedRlgl(makeConfig({ light: 'RED' }));
  await seedResult(gameId, 'T01', 'DISQUALIFIED');

  const { status, data } = await postViolation('participant');
  assert.equal(status, 200);
  assert.equal(data.ok, false);
  assert.equal(data.reason, 'ALREADY_DISQUALIFIED');

  const { rows } = await pool.query(
    'SELECT status FROM game_results WHERE game_id = $1 AND team_id = $2',
    [gameId, 'T01']
  );
  assert.equal(rows[0].status, 'DISQUALIFIED');
});

test('ADMIN cannot report a violation (403) — role guard stays authoritative', async () => {
  await seedRlgl(makeConfig({ light: 'RED' }));
  const { status } = await postViolation('admin');
  assert.equal(status, 403);
});

// ------------------------------------------------------ lifecycle ------

/** POST an admin lifecycle action (/start-round, /end-round). */
async function postLifecycle(role, action) {
  const res = await fetch(`${baseUrl}/games/rlgl/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(signToken(FIXTURES[role])) },
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

test('start-round sets ACTIVE + GREEN, resets prior results, and broadcasts rlgl:state', async () => {
  // Seed a finished round: COMPLETED with a WINNER + DISQUALIFIED row.
  const gameId = await seedRlgl(makeConfig({ gameStatus: 'COMPLETED', light: 'RED' }));
  await seedResult(gameId, 'T01', 'WINNER');
  await seedResult(gameId, 'T02', 'DISQUALIFIED');

  const [participantSocket] = await Promise.all([connectSocket('participant')]);
  try {
    const statePromise = once(participantSocket, 'rlgl:state');
    const { status, data } = await postLifecycle('admin', 'start-round');
    assert.equal(status, 200);
    assert.equal(data.state.gameStatus, 'ACTIVE');
    assert.equal(data.state.light, 'GREEN');
    assert.equal(data.state.transition, null);

    const evt = await statePromise;
    assert.equal(evt.state.gameStatus, 'ACTIVE');
    assert.equal(evt.state.light, 'GREEN');

    // Results reset to PLAYING — a previous WINNER/DQ never leaks in.
    const { rows } = await pool.query(
      'SELECT team_id, status FROM game_results WHERE game_id = $1 ORDER BY team_id',
      [gameId]
    );
    assert.deepEqual(
      rows.map((r) => [r.team_id, r.status]),
      [
        ['T01', 'PLAYING'],
        ['T02', 'PLAYING'],
      ]
    );
  } finally {
    participantSocket.disconnect();
  }
});

test('a refresh after WINNER + end-round + start-round returns the reset PLAYING result, not the stale WINNER', async () => {
  // Regression: the player page clears its held WINNER/DISQUALIFIED result when
  // a new round starts. The server contract it relies on is that /state (what a
  // refresh fetches) returns the reset row — never the previous round's result.
  const gameId = await seedRlgl(makeConfig({ gameStatus: 'COMPLETED', light: 'RED' }));
  await seedResult(gameId, 'T01', 'WINNER');
  await seedResult(gameId, 'T02', 'DISQUALIFIED');

  // Simulate: refresh DURING the completed round shows the terminal result...
  const before = await getState('participant');
  assert.equal(before.data.result.status, 'WINNER');

  // ...then the admin starts a fresh round.
  await postLifecycle('admin', 'start-round');

  // A refresh after the restart must show PLAYING (or no row), never WINNER.
  const after = await getState('participant');
  assert.equal(after.data.state.gameStatus, 'ACTIVE');
  assert.equal(after.data.result.status, 'PLAYING');
  assert.equal(after.data.result.score, null);
  assert.ok(gameId);
});

test('end-round marks COMPLETED, clears a pending transition, and stops violations/submits', async () => {
  const gameId = await seedRlgl(makeConfig());
  await seedResult(gameId, 'T01', 'PLAYING');

  // Start a GREEN->RED countdown, then end the round mid-countdown.
  await postTransition('admin', 'RED');
  let { data: stateData } = await getState('participant');
  assert.ok(stateData.state.transition, 'expected a pending transition');

  const [participantSocket] = await Promise.all([connectSocket('participant')]);
  try {
    const statePromise = once(participantSocket, 'rlgl:state');
    const { status, data } = await postLifecycle('admin', 'end-round');
    assert.equal(status, 200);
    assert.equal(data.state.gameStatus, 'COMPLETED');
    assert.equal(data.state.transition, null, 'end-round must clear pending transition');

    const evt = await statePromise;
    assert.equal(evt.state.gameStatus, 'COMPLETED');

    // A violation after end-round is a no-op (GAME_NOT_ACTIVE) — typing during
    // ENDED must never disqualify anyone.
    const v = await postViolation('participant');
    assert.equal(v.data.ok, false);
    assert.equal(v.data.reason, 'GAME_NOT_ACTIVE');

    // A submit after end-round is rejected.
    const s = await postSubmit('participant', PROBLEM.starterCode);
    assert.equal(s.status, 409);
    assert.equal(s.data.error.code, 'GAME_NOT_ACTIVE');
  } finally {
    participantSocket.disconnect();
  }
});

test('GET /state includes the caller team\'s own result row (refresh restore)', async () => {
  const gameId = await seedRlgl(makeConfig({ light: 'RED' }));
  await seedResult(gameId, 'T01', 'DISQUALIFIED');

  const { status, data } = await getState('participant');
  assert.equal(status, 200);
  assert.equal(data.result.status, 'DISQUALIFIED');
  assert.equal(String(data.result.team_id), 'T01');

  // ADMIN has no team — no result field.
  const adminState = await getState('admin');
  assert.equal(adminState.data.result, undefined);
});

test('GET /games/:id/results enriches rows with team_name for the admin roster', async () => {
  const gameId = await seedRlgl(makeConfig());
  await seedResult(gameId, 'T01', 'PLAYING');
  await seedResult(gameId, 'T02', 'DISQUALIFIED');

  const res = await fetch(`${baseUrl}/games/${gameId}/results`, {
    headers: auth(signToken(FIXTURES['admin'])),
  });
  const { results } = await res.json();
  assert.equal(res.status, 200);
  const byTeam = Object.fromEntries(results.map((r) => [r.team_id, r]));
  assert.equal(byTeam['T01'].team_name, 'Test Team');
  assert.equal(byTeam['T01'].status, 'PLAYING');
  assert.equal(byTeam['T02'].team_name, 'Second Team');
  assert.equal(byTeam['T02'].status, 'DISQUALIFIED');
});

test('disqualify-all only touches the RLGL game rows', async () => {
  const rlglGameId = await seedRlgl(makeConfig());
  await seedResult(rlglGameId, 'T01', 'PLAYING');
  await seedResult(rlglGameId, 'T02', 'QUALIFIED');

  // A separate (non-RLGL) game with a PLAYING result must be left untouched.
  const { rows: otherGame } = await pool.query(
    `INSERT INTO games (name, description, status, route) VALUES ('Other', null, 'LIVE', 'other')
     RETURNING game_id`
  );
  await seedResult(otherGame[0].game_id, 'T01', 'PLAYING');

  const { status, data } = await fetch(`${baseUrl}/games/rlgl/disqualify-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(signToken(FIXTURES['admin'])) },
  }).then(async (r) => ({ status: r.status, data: await r.json() }));
  assert.equal(status, 200);
  assert.equal(data.disqualifiedCount, 2);

  const rlglRows = await pool.query(
    'SELECT team_id, status FROM game_results WHERE game_id = $1 ORDER BY team_id',
    [rlglGameId]
  );
  assert.deepEqual(
    rlglRows.rows.map((r) => r.status),
    ['DISQUALIFIED', 'DISQUALIFIED']
  );

  const otherRows = await pool.query(
    'SELECT status FROM game_results WHERE game_id = $1 AND team_id = $2',
    [otherGame[0].game_id, 'T01']
  );
  assert.equal(otherRows.rows[0].status, 'PLAYING');
});
