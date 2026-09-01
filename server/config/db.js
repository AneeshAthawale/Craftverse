import pg from 'pg';
import { config } from './index.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  // Reasonable defaults for a local dev server; tune for production.
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client', err.message);
});

/** Run a query with a single client (for transactions, pass the client). */
export function query(text, params) {
  return pool.query(text, params);
}

/** Acquire a client for manual transaction control. */
export function getClient() {
  return pool.connect();
}

/** Ping the database (used by /api/health and dev dashboard later). */
export async function pingDb() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0].ok === 1;
}
