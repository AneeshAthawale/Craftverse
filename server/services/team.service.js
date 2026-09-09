import { query } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';

const SELECT_TEAM = `
  SELECT team_id, team_name, registration_status, registered_at, created_at, updated_at
  FROM teams`;

export async function listTeams() {
  // Admin listing: include the team leader (is_leader participant) and member
  // count so staff can review submissions without a per-team round trip.
  const { rows } = await query(
    `SELECT t.team_id, t.team_name, t.registration_status, t.registered_at,
            t.created_at, t.updated_at,
            (SELECT p.name FROM participants p
             WHERE p.team_id = t.team_id AND p.is_leader LIMIT 1) AS leader_name,
            (SELECT p.email FROM participants p
             WHERE p.team_id = t.team_id AND p.is_leader LIMIT 1) AS leader_email,
            (SELECT count(*)::int FROM participants p
             WHERE p.team_id = t.team_id) AS participant_count
     FROM teams t
     ORDER BY t.team_id`
  );
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
    `SELECT participant_id, name, email, phone, team_id, is_leader, created_at
     FROM participants WHERE team_id = $1 ORDER BY participant_id`,
    [teamId]
  );
  return rows;
}

/**
 * A single team's own game results (plan.md §16). Ownership is enforced by the
 * controller — this never exposes other teams' rows.
 */
export async function getTeamResults(teamId) {
  const { rows } = await query(
    `SELECT gr.result_id, gr.game_id, g.name AS game_name, g.status AS game_status,
            gr.team_id, gr.rank, gr.score, gr.time_seconds,
            gr.status AS result_status, gr.created_at, gr.updated_at
     FROM game_results gr
     JOIN games g ON g.game_id = gr.game_id
     WHERE gr.team_id = $1
     ORDER BY gr.created_at DESC, gr.game_id`,
    [teamId]
  );
  return rows;
}
