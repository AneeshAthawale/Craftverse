import { asyncHandler } from '../utils/asyncHandler.js';
import { validateBody } from '../middleware/validate.js';
import { ApiError } from '../utils/ApiError.js';
import * as participantService from '../services/participant.service.js';

/** ADMIN/DEV: list participants with team + leader + registration status. */
export const listParticipants = asyncHandler(async (req, res) => {
  const participants = await participantService.listParticipants();
  res.json({ participants });
});

/** ADMIN/DEV: full detail for one participant (never password_hash/tokens). */
export const getParticipant = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw ApiError.badRequest('Invalid participant id');
  const participant = await participantService.getParticipantById(id);
  res.json({ participant });
});

/**
 * ADMIN/DEV: edit name/email/phone. Only whitelisted fields are accepted —
 * team_id, is_leader, role and anything else in the body is ignored.
 */
export const updateParticipant = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw ApiError.badRequest('Invalid participant id');

  const { name, email, phone } = validateBody(req, [], {
    name: 'string',
    email: 'string',
    phone: 'string',
  });
  if (name === undefined || email === undefined) {
    throw ApiError.badRequest('name and email are required', 'VALIDATION_ERROR');
  }

  const participant = await participantService.updateParticipant(id, { name, email, phone });
  res.json({ participant });
});

/** ADMIN/DEV: reset a participant's password (explicit action, hashed). */
export const resetParticipantPassword = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw ApiError.badRequest('Invalid participant id');

  const { password } = validateBody(req, ['password'], { password: 'string' });
  const result = await participantService.resetParticipantPassword(id, password);

  res.json({
    message: `Password updated for P${String(id).padStart(3, '0')}.`,
    participant_id: result.participant_id,
  });
});

/** ADMIN/DEV: atomically make a participant the (single) team leader. */
export const makeTeamLeader = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw ApiError.badRequest('Invalid participant id');

  const { participant } = await participantService.setTeamLeader(id);
  res.json({
    participant,
    message: `${participant.name} is now the leader of ${participant.team_id}.`,
  });
});
