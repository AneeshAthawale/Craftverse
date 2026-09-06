/**
 * Test helpers for the CraftVerse backend integration suite.
 *
 * Runs against a DEDICATED throwaway database (craftverse_test) so tests never
 * touch dev data. Requires DATABASE_URL_TEST in server/.env (see .env.example).
 *
 * Env wiring happens BEFORE the app modules are imported (static imports hoist,
 * so config/db must be loaded dynamically after process.env is overridden).
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load server/.env (same file config/index.js reads).
dotenv.config({ path: path.resolve(__dirname, '../.env') });
process.env.NODE_ENV = 'test';

const TEST_URL = process.env.DATABASE_URL_TEST;
const DEV_URL = process.env.DATABASE_URL;
if (!TEST_URL) {
  console.error(
    '[test] DATABASE_URL_TEST is not set. Add it to server/.env (see .env.example) ' +
      'pointing at a separate craftverse_test database.'
  );
  process.exit(1);
}
if (TEST_URL === DEV_URL) {
  console.error(
    '[test] DATABASE_URL_TEST must differ from DATABASE_URL — refusing to run ' +
      'tests against the dev database.'
  );
  process.exit(1);
}

// Point the app's pool at the test DB before any app module imports config/db.
process.env.DATABASE_URL = TEST_URL;

// Now load the app + db lazily (pool is created against the test URL).
const { createApp } = await import('../app.js');
const { pool } = await import('../config/db.js');
const { config } = await import('../config/index.js');

const schemaSql = readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');

/** Drop everything (incl. event_status) and re-apply schema.sql. */
export async function resetSchema() {
  await pool.query(`
    DROP TABLE IF EXISTS inquiries, notifications, food_access, game_results,
      games, registration, users, participants, teams, event_status CASCADE;
  `);
  await pool.query(schemaSql);
}

/** Sign a JWT the same way auth.service does (subject is the user id string). */
export function signToken(user) {
  return jwt.sign(
    {
      sub: String(user.user_id),
      role: user.role,
      team_id: user.team_id,
      participant_id: user.participant_id,
    },
    config.jwtSecret,
    { expiresIn: '1h' }
  );
}

export const FIXTURES = {
  admin: { user_id: 1, email: 'admin@test.local', role: 'ADMIN', team_id: null, participant_id: null },
  dev: { user_id: 2, email: 'dev@test.local', role: 'DEV', team_id: null, participant_id: null },
  team: { user_id: 3, email: 't01@test.local', role: 'TEAM', team_id: 'T01', participant_id: null },
  participant: { user_id: 4, email: 'p001@test.local', role: 'PARTICIPANT', team_id: 'T01', participant_id: 1 },
};

/** Minimal rows so FKs (updated_by -> users) resolve on PATCH. */
export async function seedUsers() {
  await pool.query(
    `INSERT INTO teams (team_id, team_name, registration_token, registration_status)
     VALUES ('T01', 'Test Team', 'cv-reg-test-token', 'UNREGISTERED')
     ON CONFLICT (team_id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO participants (participant_id, name, email, team_id)
     VALUES (1, 'Test Participant', 'p001@test.local', 'T01')
     ON CONFLICT (participant_id) DO NOTHING`
  );
  for (const u of Object.values(FIXTURES)) {
    await pool.query(
      `INSERT INTO users (user_id, email, password_hash, role, participant_id, team_id)
       VALUES ($1, $2, 'unused-test-hash', $3, $4, $5)
       ON CONFLICT (user_id) DO NOTHING`,
      [u.user_id, u.email, u.role, u.participant_id ?? null, u.team_id ?? null]
    );
  }
}

export { createApp, pool, config };
