/**
 * Applies db/schema.sql to the configured PostgreSQL database.
 * Idempotent: safe to run repeatedly.
 *
 * Usage:
 *   npm run db:migrate            apply schema
 *   npm run db:reset              drop all tables, then apply schema (dev only)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

const reset = process.argv.includes('--reset');

async function main() {
  if (reset) {
    console.log('[migrate] Resetting schema (DROP + CREATE)...');
    await pool.query(`
      DROP TABLE IF EXISTS inquiries, notifications, food_access, game_results,
        games, registration, users, participants, teams CASCADE;
    `);
  }

  await pool.query(schemaSql);
  console.log('[migrate] Schema applied successfully.');

  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`
  );
  console.log(
    '[migrate] Tables:',
    rows.map((r) => r.table_name).join(', ')
  );

  await pool.end();
}

main().catch((err) => {
  console.error('[migrate] Failed:', err.message);
  process.exit(1);
});
