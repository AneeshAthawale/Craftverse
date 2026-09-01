import { asyncHandler } from '../utils/asyncHandler.js';
import { validateBody, assertEnum } from '../middleware/validate.js';
import { ApiError } from '../utils/ApiError.js';
import * as gameResultService from '../services/gameResult.service.js';

const RESULT_STATUSES = ['PLAYING', 'QUALIFIED', 'DISQUALIFIED', 'WINNER'];

export const getResults = asyncHandler(async (req, res) => {
  const gameId = Number(req.params.id);
  if (!Number.isInteger(gameId)) throw ApiError.badRequest('Invalid game id');
  const results = await gameResultService.getGameResults(gameId);
  res.json({ results });
});

export const upsertResult = asyncHandler(async (req, res) => {
  const gameId = Number(req.params.id);
  if (!Number.isInteger(gameId)) throw ApiError.badRequest('Invalid game id');

  const { team_id, rank, score, time_seconds, status } = validateBody(req, ['team_id'], {
    rank: 'number',
    score: 'number',
    time_seconds: 'number',
    status: 'string',
  });
  assertEnum('status', status, RESULT_STATUSES);

  const result = await gameResultService.upsertGameResult(gameId, team_id, {
    rank,
    score,
    time_seconds,
    status,
  });

  const io = req.app.get('io');
  if (io) {
    io.to(`team:${team_id}`).emit('game:updated', {
      type: 'result',
      gameId,
      result,
    });
  }

  res.status(201).json({ result });
});

export const deleteResult = asyncHandler(async (req, res) => {
  const gameId = Number(req.params.id);
  const { team_id } = req.params;
  if (!Number.isInteger(gameId)) throw ApiError.badRequest('Invalid game id');
  const result = await gameResultService.deleteGameResult(gameId, team_id);
  res.json(result);
});
