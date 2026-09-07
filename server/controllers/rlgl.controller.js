/**
 * RLGL REST controller.
 *
 * Routes (all mounted under /api/games/rlgl, authenticated):
 *   GET  /state         any authenticated user
 *   POST /transition    ADMIN/DEV — schedule a light change (server countdown)
 *   POST /submit        TEAM/PARTICIPANT — submit code for the round problem
 *   POST /disqualify/:teamId  ADMIN/DEV
 *   POST /disqualify-all      ADMIN/DEV
 *   POST /reinstate/:teamId   ADMIN/DEV (undo a mistaken disqualification)
 *   POST /start-round         ADMIN/DEV — gameStatus=ACTIVE + reset results
 *   POST /end-round           ADMIN/DEV — gameStatus=COMPLETED
 */
import { asyncHandler } from '../utils/asyncHandler.js';
import { validateBody, assertEnum } from '../middleware/validate.js';
import { ApiError } from '../utils/ApiError.js';
import * as rlglService from '../services/rlgl.service.js';
import { LIGHTS, GAME_STATUSES } from '../services/rlgl.service.js';

/**
 * GET /api/games/rlgl/state — public gameplay config + authoritative state.
 * When the caller belongs to a team, the response also includes their own
 * game_results row so a player page refresh/reconnect restores DISQUALIFIED /
 * WINNER status instead of showing a stale "playing" editor.
 */
export const getState = asyncHandler(async (req, res) => {
  const state = await rlglService.getRlglPublicState(req.user.team_id ?? null);
  res.json(state);
});

/** POST /api/games/rlgl/transition — schedule a state change (ADMIN/DEV). */
export const postTransition = asyncHandler(async (req, res) => {
  const { to } = validateBody(req, ['to'], { to: 'string' });
  assertEnum('to', to, LIGHTS);

  const { state, scheduled, reason } = await rlglService.scheduleTransition(to);

  if (scheduled) {
    const io = req.app.get('io');
    if (io) {
      io.emit('rlgl:state', { gameId: state.gameId, state });
    }
  }

  res.json({ scheduled, reason: reason ?? null, state });
});

/** POST /api/games/rlgl/submit — evaluate code against the round problem. */
export const postSubmit = asyncHandler(async (req, res) => {
  const { code } = validateBody(req, ['code'], { code: 'string' });

  if (!req.user.team_id) {
    throw ApiError.forbidden('You are not part of a team');
  }

  const outcome = await rlglService.submitSolution({
    teamId: req.user.team_id,
    code,
  });
  res.json(outcome);
});

/**
 * POST /api/games/rlgl/violation — report a RED-light typing violation.
 * Socket fallback for the player page; the socket rlgl:violation event is the
 * primary path. Team identity comes from the JWT and the service validates the
 * CURRENT authoritative light is RED before disqualifying.
 */
export const postViolation = asyncHandler(async (req, res) => {
  if (!req.user.team_id) {
    throw ApiError.forbidden('You are not part of a team');
  }
  const outcome = await rlglService.reportRedLightViolation(req.user.team_id);
  res.json(outcome);
});

/** POST /api/games/rlgl/disqualify/:teamId — admin manual disqualification. */
export const postDisqualifyTeam = asyncHandler(async (req, res) => {
  const { teamId } = req.params;
  const result = await rlglService.disqualifyTeam(teamId);
  res.json({ result });
});

/** POST /api/games/rlgl/disqualify-all — disqualify every active team. */
export const postDisqualifyAll = asyncHandler(async (req, res) => {
  const outcome = await rlglService.disqualifyAllTeams();
  res.json(outcome);
});

/** POST /api/games/rlgl/reinstate/:teamId — undo a disqualification. */
export const postReinstateTeam = asyncHandler(async (req, res) => {
  const { teamId } = req.params;
  const result = await rlglService.reinstateTeam(teamId);
  res.json({ result });
});

/** POST /api/games/rlgl/start-round — ACTIVE + GREEN + reset results. */
export const postStartRound = asyncHandler(async (req, res) => {
  const { state, resetCount } = await rlglService.startRound();
  const io = req.app.get('io');
  if (io) io.emit('rlgl:state', { gameId: state.gameId, state });
  res.json({ state, resetCount });
});

/** POST /api/games/rlgl/end-round — mark the round COMPLETED. */
export const postEndRound = asyncHandler(async (req, res) => {
  const { state } = await rlglService.endRound();
  const io = req.app.get('io');
  if (io) io.emit('rlgl:state', { gameId: state.gameId, state });
  res.json({ state });
});
