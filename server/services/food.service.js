import { query, getClient } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { randomHex } from '../utils/token.js';
import { getCurrentMeal, mealLabel } from '../utils/mealSchedule.js';

const SELECT_FOOD = `
  SELECT food_access_id, participant_id, meal_type, event_day, token, status,
         used_at, expires_at, created_at
  FROM food_access`;

/**
 * Participant's current food token (plan.md §12).
 * Determines the active meal window; returns the UNUSED token for that meal,
 * creating it on first request. Returns null when no meal is active.
 */
export async function getOrCreateCurrentFoodToken(participantId) {
  const current = getCurrentMeal();
  if (!current) {
    return { meal: null, access: null };
  }
  const { mealType, eventDay } = current;

  const { rows: existing } = await query(
    `${SELECT_FOOD} WHERE participant_id = $1 AND meal_type = $2 AND event_day = $3`,
    [participantId, mealType, eventDay]
  );

  if (existing[0]) {
    return { meal: mealLabel(mealType, eventDay), access: existing[0] };
  }

  const token = `cv-food-${String(participantId).padStart(3, '0')}-D${eventDay}-${mealType}-${randomHex(8)}`;
  const { rows } = await query(
    `INSERT INTO food_access (participant_id, meal_type, event_day, token)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (participant_id, meal_type, event_day) DO NOTHING
     RETURNING food_access_id, participant_id, meal_type, event_day, token, status,
               used_at, expires_at, created_at`,
    [participantId, mealType, eventDay, token]
  );

  return { meal: mealLabel(mealType, eventDay), access: rows[0] };
}

/** Admin/DEV view: all food access records, optionally filtered by day. */
export async function listFoodAccess({ eventDay, status } = {}) {
  const clauses = [];
  const params = [];
  if (eventDay) {
    params.push(eventDay);
    clauses.push(`event_day = $${params.length}`);
  }
  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await query(
    `${SELECT_FOOD} ${where} ORDER BY created_at DESC LIMIT 500`,
    params
  );
  return rows;
}

/**
 * Verify a food token (staff scan, plan.md §12).
 * Checks: token exists, participant exists, meal/day match the active window,
 * status is UNUSED. Marks USED + used_at atomically. A used token is rejected.
 */
export async function verifyFoodToken(token) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `${SELECT_FOOD} WHERE token = $1 FOR UPDATE`,
      [token]
    );
    const access = rows[0];
    if (!access) {
      throw ApiError.notFound('Food token not found', 'INVALID_TOKEN');
    }

    if (access.status === 'USED') {
      throw ApiError.conflict('This food token has already been used', 'ALREADY_USED');
    }
    if (access.status === 'EXPIRED') {
      throw ApiError.conflict('This food token has expired', 'TOKEN_EXPIRED');
    }
    if (access.expires_at && new Date(access.expires_at) < new Date()) {
      await client.query(
        `UPDATE food_access SET status = 'EXPIRED', updated_at = now() WHERE food_access_id = $1`,
        [access.food_access_id]
      );
      throw ApiError.conflict('This food token has expired', 'TOKEN_EXPIRED');
    }

    // Meal window check — only enforce when the token is not already expired.
    // In development, ALLOW_OUTSIDE_MEAL_WINDOW=1 lets seeded tokens be verified
    // outside meal hours (for testing the lifecycle). Production stays strict.
    const current = getCurrentMeal();
    const mealMatches =
      current &&
      current.mealType === access.meal_type &&
      current.eventDay === access.event_day;
    const allowOutside = process.env.ALLOW_OUTSIDE_MEAL_WINDOW === '1';
    if (!mealMatches && !allowOutside) {
      throw ApiError.conflict(
        `This token is for ${mealLabel(access.meal_type, access.event_day)} and is not active right now`,
        'MEAL_NOT_ACTIVE'
      );
    }

    const { rows: participantRows } = await client.query(
      `SELECT participant_id, name, team_id FROM participants WHERE participant_id = $1`,
      [access.participant_id]
    );
    const participant = participantRows[0];

    const { rows: updated } = await client.query(
      `UPDATE food_access SET status = 'USED', used_at = now(), updated_at = now()
       WHERE food_access_id = $1
       RETURNING food_access_id, participant_id, meal_type, event_day, token, status,
                 used_at, expires_at, created_at`,
      [access.food_access_id]
    );

    await client.query('COMMIT');
    return {
      access: updated[0],
      participant,
      mealLabel: mealLabel(access.meal_type, access.event_day),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
