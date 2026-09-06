import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { query } from '../config/db.js';
import * as teamService from '../services/team.service.js';

export const listTeams = asyncHandler(async (req, res) => {
  const teams = await teamService.listTeams();
  res.json({ teams });
});

export const getTeam = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // TEAM/PARTICIPANT users may only view their own team.
  if (
    (req.user.role === 'TEAM' || req.user.role === 'PARTICIPANT') &&
    req.user.team_id !== id
  ) {
    throw ApiError.forbidden('You can only view your own team');
  }

  const team = await teamService.getTeamById(id);
  const participants = await teamService.getTeamParticipants(id);
  res.json({ team, participants });
});

export const getTeamQr = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // TEAM-role users may only fetch their own team's registration QR.
  if (req.user.role === 'TEAM' && req.user.team_id !== id) {
    throw ApiError.forbidden('You can only view your own team QR');
  }

  const team = await teamService.getTeamById(id);
  const { rows } = await query('SELECT token FROM registration WHERE team_id = $1', [id]);
  const token = rows[0]?.token || team.registration_token;

  // The token is what gets encoded into the QR; sensitive info is not included.
  res.json({
    team_id: team.team_id,
    team_name: team.team_name,
    registration_status: team.registration_status,
    token,
  });
});

/** A team's own game results — same ownership rule as getTeam. */
export const getTeamResults = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // TEAM/PARTICIPANT users may only view their own team's results.
  if (
    (req.user.role === 'TEAM' || req.user.role === 'PARTICIPANT') &&
    req.user.team_id !== id
  ) {
    throw ApiError.forbidden('You can only view your own team results');
  }

  // 404 for an unknown team (matches getTeam behavior via getTeamById).
  await teamService.getTeamById(id);
  const results = await teamService.getTeamResults(id);
  res.json({ results });
});
