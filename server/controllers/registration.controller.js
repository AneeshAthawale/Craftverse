import { asyncHandler } from '../utils/asyncHandler.js';
import { validateBody } from '../middleware/validate.js';
import * as registrationService from '../services/registration.service.js';

/** Lookup for QR display — returns team name + registration status only. */
export const getByToken = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const info = await registrationService.getRegistrationByToken(token);
  res.json({ registration: info });
});

/** Single-use verification performed by the organizer (ADMIN/DEV). */
export const verify = asyncHandler(async (req, res) => {
  const { token } = validateBody(req, ['token']);
  const team = await registrationService.verifyRegistration(token);

  const io = req.app.get('io');
  if (io) {
    io.to(`team:${team.team_id}`).emit('registration:completed', { team });
    io.to('admin').emit('registration:completed', { team });
  }

  res.json({ team, message: 'Team registered successfully' });
});
