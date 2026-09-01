/**
 * DEVELOPMENT SEED DATA — never use in production.
 *
 * Usage: npm run db:seed
 * Requires an existing schema (run npm run db:migrate first).
 *
 * This seeds:
 *  - DEV + ADMIN users
 *  - 3 teams (T01–T03) with registration tokens + TEAM users
 *  - 6 participants (P001–P006) with PARTICIPANT users
 *  - 3 games (RLGL LIVE, Game 2 UPCOMING, Game 3 LOCKED)
 *  - RLGL game_results for the 3 seeded teams
 *  - One UNUSED food token per participant (Day 1 Lunch)
 *  - 2 notifications, 1 open inquiry
 *
 * Credentials are printed at the end. Tokens are regenerated on each seed run
 * via ON CONFLICT DO UPDATE so re-seeding refreshes them.
 */
import bcrypt from 'bcryptjs';
import { pool } from '../config/db.js';
import { randomHex, randomToken } from '../utils/token.js';

const hash = await bcrypt.hash('devpass123', 10);

const TEAMS = [
  { team_id: 'T01', team_name: 'Null Pointers' },
  { team_id: 'T02', team_name: 'CyberKnight' },
  { team_id: 'T03', team_name: 'Phoenix Devs' },
];

const PARTICIPANTS = [
  { participant_id: 1, name: 'Alex Developer', email: 'alex@example.com', phone: '9000000001', team_id: 'T01' },
  { participant_id: 2, name: 'Sam Tester', email: 'sam@example.com', phone: '9000000002', team_id: 'T01' },
  { participant_id: 3, name: 'Jordan Coder', email: 'jordan@example.com', phone: '9000000003', team_id: 'T02' },
  { participant_id: 4, name: 'Riley Hacker', email: 'riley@example.com', phone: '9000000004', team_id: 'T02' },
  { participant_id: 5, name: 'Casey Builder', email: 'casey@example.com', phone: '9000000005', team_id: 'T03' },
  { participant_id: 6, name: 'Morgan Designer', email: 'morgan@example.com', phone: '9000000006', team_id: 'T03' },
];

async function main() {
  console.log('[seed] Seeding dev data...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ---- Teams + registration tokens (regenerated each seed run) ----
    for (const team of TEAMS) {
      const token = `cv-reg-${team.team_id}-${randomHex(8)}`;
      await client.query(
        `INSERT INTO teams (team_id, team_name, registration_token, registration_status)
         VALUES ($1, $2, $3, 'UNREGISTERED')
         ON CONFLICT (team_id) DO UPDATE SET
           team_name = EXCLUDED.team_name,
           registration_token = EXCLUDED.registration_token,
           registration_status = 'UNREGISTERED',
           registered_at = NULL,
           updated_at = now()`,
        [team.team_id, team.team_name, token]
      );
      await client.query(
        `INSERT INTO registration (team_id, token, status)
         VALUES ($1, $2, 'UNREGISTERED')
         ON CONFLICT (team_id) DO UPDATE SET
           token = EXCLUDED.token,
           status = 'UNREGISTERED',
           verified_at = NULL,
           updated_at = now()`,
        [team.team_id, token]
      );
    }

    // ---- Participants ----
    for (const p of PARTICIPANTS) {
      await client.query(
        `INSERT INTO participants (participant_id, name, email, phone, team_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (participant_id) DO UPDATE SET
           name = EXCLUDED.name,
           email = EXCLUDED.email,
           phone = EXCLUDED.phone,
           team_id = EXCLUDED.team_id,
           updated_at = now()`,
        [p.participant_id, p.name, p.email, p.phone, p.team_id]
      );
    }

    // ---- Users (DEV, ADMIN, TEAM per team, PARTICIPANT per participant) ----
    const users = [
      { email: 'dev@craftverse.test', role: 'DEV' },
      { email: 'admin@craftverse.test', role: 'ADMIN' },
      ...TEAMS.map((t) => ({
        email: `${t.team_id.toLowerCase()}@craftverse.test`,
        role: 'TEAM',
        team_id: t.team_id,
      })),
      ...PARTICIPANTS.map((p) => ({
        email: `p${String(p.participant_id).padStart(3, '0')}@craftverse.test`,
        role: 'PARTICIPANT',
        participant_id: p.participant_id,
        team_id: p.team_id,
      })),
    ];

    for (const u of users) {
      await client.query(
        `INSERT INTO users (email, password_hash, role, participant_id, team_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           participant_id = EXCLUDED.participant_id,
           team_id = EXCLUDED.team_id,
           updated_at = now()`,
        [u.email, hash, u.role, u.participant_id ?? null, u.team_id ?? null]
      );
    }

    // ---- Games ----
    const games = [
      { name: 'Red Light Green Light', description: 'Offline night survival & debugging session.', rules: 'Code during GREEN. Stop during RED.', status: 'LIVE', route: 'rlgl' },
      { name: 'Game 2', description: 'Second hackathon game.', rules: null, status: 'UPCOMING', route: 'game-2' },
      { name: 'Game 3', description: 'Third hackathon game.', rules: null, status: 'LOCKED', route: 'game-3' },
    ];
    for (const g of games) {
      await client.query(
        `INSERT INTO games (name, description, rules, status, route)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (route) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           rules = EXCLUDED.rules,
           status = EXCLUDED.status,
           updated_at = now()`,
        [g.name, g.description, g.rules, g.status, g.route]
      );
    }

    // ---- RLGL game_results (reused structure; proves plan.md §16) ----
    const { rows: gameRows } = await client.query(
      `SELECT game_id FROM games WHERE route = 'rlgl'`
    );
    const rlglGameId = gameRows[0].game_id;
    const results = [
      { team_id: 'T01', rank: 1, score: 98, time_seconds: 340, status: 'WINNER' },
      { team_id: 'T02', rank: 2, score: 94, time_seconds: 420, status: 'QUALIFIED' },
      { team_id: 'T03', rank: null, score: 0, time_seconds: null, status: 'DISQUALIFIED' },
    ];
    for (const r of results) {
      await client.query(
        `INSERT INTO game_results (game_id, team_id, rank, score, time_seconds, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (game_id, team_id) DO UPDATE SET
           rank = EXCLUDED.rank,
           score = EXCLUDED.score,
           time_seconds = EXCLUDED.time_seconds,
           status = EXCLUDED.status,
           updated_at = now()`,
        [rlglGameId, r.team_id, r.rank, r.score, r.time_seconds, r.status]
      );
    }

    // ---- Food access: one UNUSED token per participant for Day 1 Lunch ----
    for (const p of PARTICIPANTS) {
      const token = `cv-food-${String(p.participant_id).padStart(3, '0')}-D1-LUNCH-${randomHex(8)}`;
      await client.query(
        `INSERT INTO food_access (participant_id, meal_type, event_day, token)
         VALUES ($1, 'LUNCH', 1, $2)
         ON CONFLICT (participant_id, meal_type, event_day) DO UPDATE SET
           token = EXCLUDED.token,
           status = 'UNUSED',
           used_at = NULL,
           expires_at = NULL`,
        [p.participant_id, token]
      );
    }

    // ---- Notifications ----
    await client.query(
      `INSERT INTO notifications (type, title, message) VALUES
       ('GAME', 'Red Light Green Light starting soon', 'All teams report to Arena 1. Game starts in 10 minutes.'),
       ('NORMAL', 'Lunch is now available', 'Day 1 lunch is being served at the food court.')
       ON CONFLICT DO NOTHING`
    );

    // ---- Inquiries ----
    await client.query(
      `INSERT INTO inquiries (participant_id, team_id, title, message, status)
       VALUES (1, 'T01', 'Lunch QR missing', 'I have not received my lunch QR.', 'OPEN')
       ON CONFLICT DO NOTHING`
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log('[seed] Done. Dev credentials:');
  console.log('  DEV       dev@craftverse.test   / devpass123');
  console.log('  ADMIN     admin@craftverse.test / devpass123');
  for (const t of TEAMS) {
    console.log(`  TEAM      ${t.team_id.toLowerCase()}@craftverse.test / devpass123  (${t.team_id})`);
  }
  for (const p of PARTICIPANTS) {
    console.log(`  PART      p${String(p.participant_id).padStart(3, '0')}@craftverse.test / devpass123  (P${String(p.participant_id).padStart(3, '0')}, ${p.team_id})`);
  }
  console.log('[seed] Registration tokens:');
  const { rows: tokens } = await pool.query('SELECT team_id, registration_token FROM teams ORDER BY team_id');
  for (const t of tokens) {
    console.log(`  ${t.team_id}: ${t.registration_token}`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error('[seed] Failed:', err.message);
  process.exit(1);
});
