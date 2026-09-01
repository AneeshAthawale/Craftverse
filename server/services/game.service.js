import { query } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';

const SELECT_GAME = `
  SELECT game_id, name, description, rules, status, route, starts_at, ends_at, config,
         created_at, updated_at
  FROM games`;

export async function listGames() {
  const { rows } = await query(`${SELECT_GAME} ORDER BY game_id`);
  return rows;
}

export async function getGameById(gameId) {
  const { rows } = await query(`${SELECT_GAME} WHERE game_id = $1`, [gameId]);
  if (!rows[0]) throw ApiError.notFound('Game not found');
  return rows[0];
}

export async function getGameByRoute(route) {
  const { rows } = await query(`${SELECT_GAME} WHERE route = $1`, [route]);
  return rows[0] || null;
}

export async function createGame({ name, description, rules, status, route, starts_at, ends_at, config }) {
  const { rows } = await query(
    `INSERT INTO games (name, description, rules, status, route, starts_at, ends_at, config)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [name, description ?? null, rules ?? null, status ?? 'UPCOMING', route ?? null,
     starts_at ?? null, ends_at ?? null, config ?? null]
  );
  return rows[0];
}

/**
 * Update a game. Allowed fields: name, description, rules, status, route,
 * starts_at, ends_at, config. Returns the updated game + the previous status
 * so the controller can emit the right socket event.
 */
export async function updateGame(gameId, fields) {
  const current = await getGameById(gameId);

  const cols = [];
  const params = [];
  const map = {
    name: fields.name,
    description: fields.description,
    rules: fields.rules,
    status: fields.status,
    route: fields.route,
    starts_at: fields.starts_at,
    ends_at: fields.ends_at,
    config: fields.config,
  };
  for (const [col, value] of Object.entries(map)) {
    if (value !== undefined) {
      params.push(value);
      cols.push(`${col} = $${params.length}`);
    }
  }
  if (cols.length === 0) return current;

  params.push(gameId);
  const { rows } = await query(
    `UPDATE games SET ${cols.join(', ')}, updated_at = now() WHERE game_id = $${params.length}
     RETURNING *`,
    params
  );
  return { previous: current, updated: rows[0] };
}
