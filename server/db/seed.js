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
 *  - RLGL games.config: the shared round problem + authoritative light state
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

// Passwords: DEV + ADMIN share a dev password; TEAM + PARTICIPANT share a
// participant-facing password. Distinct hashes so each group logs in with its own.
const hash = await bcrypt.hash('team123', 10);
const adminHash = await bcrypt.hash('dev123', 10);

// ---- RLGL round problem + authoritative state ----
// Stored in the RLGL game row's games.config JSONB. The light state and any
// pending transition deadline are server-authoritative and read/written only
// by server/services/rlgl.service.js.
const RLGL_PROBLEM = {
  id: 'rlgl_round_problem',
  title: 'Cyber String Decryptor (Reverse Words)',
  domain: 'CYBERSECURITY',
  difficulty: 'Easy',
  description:
    'An encrypted telemetry packet is a sentence of words separated by spaces. ' +
    'Write a function reverseWords(str) that returns the words in reverse order, ' +
    'trimming leading/trailing whitespace and collapsing runs of spaces to a single space.',
  starterCode:
    'function reverseWords(str) {\n  // Code during GREEN LIGHT only.\n  return str.trim().split(/\\s+/).reverse().join(" ");\n}',
  fnName: 'reverseWords',
  testCases: [
    { input: ['"the sky is blue"'], expected: '"blue is sky the"' },
    { input: ['"  hello world  "'], expected: '"world hello"' },
    { input: ['"a good   example"'], expected: '"example good a"' },
  ],
};

const RLGL_CONFIG = {
  problem: RLGL_PROBLEM,
  countdownSeconds: 3,
  state: {
    light: 'GREEN',
    gameStatus: 'ACTIVE',
    transition: null,
    updatedAt: new Date().toISOString(),
  },
};

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
      { email: 'dev@craftverse.test', role: 'DEV', passwordHash: adminHash },
      { email: 'admin@craftverse.test', role: 'ADMIN', passwordHash: adminHash },
      ...TEAMS.map((t) => ({
        email: `${t.team_id.toLowerCase()}@craftverse.test`,
        role: 'TEAM',
        passwordHash: hash,
        team_id: t.team_id,
      })),
      ...PARTICIPANTS.map((p) => ({
        email: `p${String(p.participant_id).padStart(3, '0')}@craftverse.test`,
        role: 'PARTICIPANT',
        passwordHash: hash,
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
        [u.email, u.passwordHash, u.role, u.participant_id ?? null, u.team_id ?? null]
      );
    }

    // ---- Games ----
    const games = [
      { name: 'Red Light Green Light', description: 'Offline night survival & debugging session.', rules: 'Code during GREEN. Stop during RED.', status: 'LIVE', route: 'rlgl', config: RLGL_CONFIG },
      { name: 'Game 2', description: 'Second hackathon game.', rules: null, status: 'UPCOMING', route: 'game-2' },
      { name: 'Game 3', description: 'Third hackathon game.', rules: null, status: 'LOCKED', route: 'game-3' },
    ];
    for (const g of games) {
      await client.query(
        `INSERT INTO games (name, description, rules, status, route, config)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (route) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           rules = EXCLUDED.rules,
           status = EXCLUDED.status,
           config = EXCLUDED.config,
           updated_at = now()`,
        [g.name, g.description, g.rules, g.status, g.route, g.config ?? null]
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
  console.log('  DEV       dev@craftverse.test   / dev123');
  console.log('  ADMIN     admin@craftverse.test / dev123');
  for (const t of TEAMS) {
    console.log(`  TEAM      ${t.team_id.toLowerCase()}@craftverse.test / team123  (${t.team_id})`);
  }
  for (const p of PARTICIPANTS) {
    console.log(`  PART      p${String(p.participant_id).padStart(3, '0')}@craftverse.test / team123  (P${String(p.participant_id).padStart(3, '0')}, ${p.team_id})`);
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
