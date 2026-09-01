import { query } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';

const SELECT_TEAM = `
  SELECT team_id, team_name, registration_status, registered_at, created_at, updated_at
  FROM teams`;

export async function listTeams() {
  const { rows } = await query(`${SELECT_TEAM} ORDER BY team_id`);
  return rows;
}

export async function getTeamById(teamId) {
  const { rows } = await query(`${SELECT_TEAM} WHERE team_id = $1`, [teamId]);
  if (!rows[0]) throw ApiError.notFound('Team not found');
  return rows[0];
}

/** Members of a team (participants). */
export async function getTeamParticipants(teamId) {
  const { rows } = await query(
    `SELECT participant_id, name, email, phone, team_id, created_at
     FROM participants WHERE team_id = $1 ORDER BY participant_id`,
    [teamId]
  );
  return rows;
}
