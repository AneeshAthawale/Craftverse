import { asyncHandler } from '../utils/asyncHandler.js';
import { validateBody } from '../middleware/validate.js';
import { ApiError } from '../utils/ApiError.js';
import * as foodService from '../services/food.service.js';

/** Participant's own current food token/QR. */
export const getMyFood = asyncHandler(async (req, res) => {
  const participantId = req.user.participant_id;
  if (!participantId) {
    throw ApiError.forbidden('Your account is not linked to a participant');
  }
  const result = await foodService.getOrCreateCurrentFoodToken(participantId);
  res.json(result);
});

/** Admin/DEV: list food access records. */
export const listAccess = asyncHandler(async (req, res) => {
  const { eventDay, status } = req.query;
  const access = await foodService.listFoodAccess({
    eventDay: eventDay ? Number(eventDay) : undefined,
    status: status || undefined,
  });
  res.json({ access });
});

/** Staff scan: validate a food token and mark it used. */
export const verify = asyncHandler(async (req, res) => {
  const { token } = validateBody(req, ['token']);
  const result = await foodService.verifyFoodToken(token);

  const io = req.app.get('io');
  if (io) {
    io.to(`team:${result.participant.team_id}`).emit('food:access:updated', {
      participantId: result.participant.participant_id,
      status: result.access.status,
    });
    io.to('admin').emit('food:access:updated', result);
  }

  res.json({ granted: true, ...result });
});
