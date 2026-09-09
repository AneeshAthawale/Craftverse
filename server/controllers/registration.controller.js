import { asyncHandler } from '../utils/asyncHandler.js';
import { validateBody } from '../middleware/validate.js';
import * as registrationService from '../services/registration.service.js';

/**
 * Public team registration (no auth). Creates the team, its participants
 * (leader flagged), their PARTICIPANT login accounts, and the Registration QR
 * token atomically. The response never includes the QR token and never claims
 * an email was sent.
 */
export const registerPublic = asyncHandler(async (req, res) => {
  const result = await registrationService.registerTeam(req.body);
  res.status(201).json({
    team: {
      team_id: result.team_id,
      team_name: result.team_name,
      registration_status: result.registration_status,
    },
    message:
      'Team registration submitted. Team members can sign in with their email and the team password to view the Registration QR.',
  });
});

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
