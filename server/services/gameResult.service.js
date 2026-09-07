import { query } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';

const SELECT_RESULT = `
  SELECT gr.result_id, gr.game_id, gr.team_id, gr.rank, gr.score,
         gr.time_seconds, gr.status, gr.created_at, gr.updated_at,
         t.team_name
  FROM game_results gr
  LEFT JOIN teams t ON t.team_id = gr.team_id`;

export async function getGameResults(gameId) {
  const { rows } = await query(
    `${SELECT_RESULT} WHERE gr.game_id = $1 ORDER BY gr.rank NULLS LAST, gr.status, gr.team_id`,
    [gameId]
  );
  return rows;
}

/**
 * Upsert one team's result for a game (plan.md §16).
 * Reusable across games; rows are never deleted.
 */
export async function upsertGameResult(gameId, teamId, { rank, score, time_seconds, status }) {
  const { rows } = await query(
    `INSERT INTO game_results (game_id, team_id, rank, score, time_seconds, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (game_id, team_id) DO UPDATE SET
       rank = EXCLUDED.rank,
       score = EXCLUDED.score,
       time_seconds = EXCLUDED.time_seconds,
       status = EXCLUDED.status,
       updated_at = now()
     RETURNING result_id, game_id, team_id, rank, score, time_seconds, status,
               created_at, updated_at`,
    [gameId, teamId, rank ?? null, score ?? null, time_seconds ?? null, status ?? 'PLAYING']
  );
  return rows[0];
}

export async function deleteGameResult(gameId, teamId) {
  const { rowCount } = await query(
    'DELETE FROM game_results WHERE game_id = $1 AND team_id = $2',
    [gameId, teamId]
  );
  if (rowCount === 0) throw ApiError.notFound('Game result not found');
  return { deleted: true };
}
