import { asyncHandler } from '../utils/asyncHandler.js';
import { validateBody, assertEnum } from '../middleware/validate.js';
import { ApiError } from '../utils/ApiError.js';
import * as gameService from '../services/game.service.js';

const GAME_STATUSES = ['UPCOMING', 'LIVE', 'PAUSED', 'COMPLETED', 'LOCKED'];

export const listGames = asyncHandler(async (req, res) => {
  const games = await gameService.listGames();
  res.json({ games });
});

export const getGame = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw ApiError.badRequest('Invalid game id');
  const game = await gameService.getGameById(id);
  res.json({ game });
});

export const createGame = asyncHandler(async (req, res) => {
  const { name, description, rules, status, route, starts_at, ends_at, config } = validateBody(
    req,
    ['name'],
    {
      description: 'string',
      rules: 'string',
      status: 'string',
      route: 'string',
      starts_at: 'string',
      ends_at: 'string',
      config: 'object',
    }
  );
  assertEnum('status', status, GAME_STATUSES);
  const game = await gameService.createGame({ name, description, rules, status, route, starts_at, ends_at, config });
  res.status(201).json({ game });
});

export const updateGame = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw ApiError.badRequest('Invalid game id');

  const fields = validateBody(req, [], {
    name: 'string',
    description: 'string',
    rules: 'string',
    status: 'string',
    route: 'string',
    starts_at: 'string',
    ends_at: 'string',
    config: 'object',
  });
  assertEnum('status', fields.status, GAME_STATUSES);

  const { previous, updated } = await gameService.updateGame(id, fields);

  // Emit real-time game events on status transitions (plan.md §18).
  const io = req.app.get('io');
  if (io && updated.status !== previous.status) {
    if (updated.status === 'LIVE') {
      io.emit('game:started', { game: updated });
    } else if (updated.status === 'COMPLETED') {
      io.emit('game:ended', { game: updated });
    } else {
      io.emit('game:updated', { game: updated });
    }
  }

  res.json({ game: updated });
});
