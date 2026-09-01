import { query, getClient } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Look up registration info by token. Returns only non-sensitive data:
 * team name + registration status (used to display the QR / status page).
 */
export async function getRegistrationByToken(token) {
  const { rows } = await query(
    `SELECT t.team_id, t.team_name, t.registration_status
     FROM teams t
     WHERE t.registration_token = $1`,
    [token]
  );
  if (!rows[0]) throw ApiError.notFound('Registration token not found', 'INVALID_TOKEN');
  return rows[0];
}

/**
 * Single-use registration verification (plan.md §8).
 * - Marks the team REGISTERED in both `teams` and `registration`.
 * - A second scan of the same token returns 409 ALREADY_REGISTERED.
 * - Never trusts a team_id supplied by the client.
 */
export async function verifyRegistration(token) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT team_id, registration_status FROM teams WHERE registration_token = $1 FOR UPDATE`,
      [token]
    );
    const team = rows[0];
    if (!team) {
      throw ApiError.notFound('Registration token not found', 'INVALID_TOKEN');
    }
    if (team.registration_status === 'REGISTERED') {
      throw ApiError.conflict(
        `Team ${team.team_id} is already registered`,
        'ALREADY_REGISTERED'
      );
    }

    const now = new Date();
    await client.query(
      `UPDATE teams SET registration_status = 'REGISTERED', registered_at = $2, updated_at = $2
       WHERE team_id = $1`,
      [team.team_id, now]
    );
    await client.query(
      `UPDATE registration SET status = 'REGISTERED', verified_at = $2, updated_at = $2
       WHERE team_id = $1`,
      [team.team_id, now]
    );

    const { rows: teamRow } = await client.query(
      `SELECT team_id, team_name, registration_status, registered_at
       FROM teams WHERE team_id = $1`,
      [team.team_id]
    );

    await client.query('COMMIT');
    return teamRow[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
