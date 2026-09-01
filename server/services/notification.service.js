import { query } from '../config/db.js';

const SELECT_NOTIFICATION = `
  SELECT notification_id, type, title, message, created_at
  FROM notifications`;

export async function listNotifications(limit = 50) {
  const { rows } = await query(
    `${SELECT_NOTIFICATION} ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function createNotification({ type, title, message }) {
  const { rows } = await query(
    `INSERT INTO notifications (type, title, message)
     VALUES ($1, $2, $3)
     RETURNING notification_id, type, title, message, created_at`,
    [type, title, message]
  );
  return rows[0];
}
