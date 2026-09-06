import { query } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';

const SELECT_EVENT_STATUS = `
  SELECT status, updated_at, updated_by
  FROM event_status
  WHERE id = 1`;

/**
 * Read the authoritative hackathon-wide event status (plan.md lifecycle:
 * NOT_STARTED → LIVE ⇄ BREAK → ENDED). Single singleton row (id = 1).
 */
export async function getEventStatus() {
  const { rows } = await query(SELECT_EVENT_STATUS);
  if (!rows[0]) throw ApiError.notFound('Event status not initialized');
  return rows[0];
}

/**
 * Persist a new event status. The caller validates the enum before calling.
 * Single-row UPDATE is atomic — concurrent admin updates serialize on the row
 * and PostgreSQL remains the source of truth.
 */
export async function updateEventStatus(status, userId) {
  const { rows } = await query(
    `UPDATE event_status
     SET status = $1, updated_at = now(), updated_by = $2
     WHERE id = 1
     RETURNING status, updated_at, updated_by`,
    [status, userId ?? null]
  );
  if (!rows[0]) throw ApiError.notFound('Event status not initialized');
  return rows[0];
}
