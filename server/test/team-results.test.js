/**
 * Phase 5 — Team Dashboard backend tests.
 *
 * Covers the new `GET /teams/:id/results` ownership endpoint:
 *  - TEAM sees only its own results
 *  - TEAM is forbidden from another team's results
 *  - PARTICIPANT sees own team's results, forbidden from another team's
 *  - ADMIN/DEV may read any team's results
 *  - GET /teams/:id ownership is enforced for TEAM
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetSchema,
  seedUsers,
  signToken,
  FIXTURES,
  createApp,
  pool,
} from './helpers.js';

let server;
let baseUrl;

const TEAM2 = { user_id: 5, email: 't02@test.local', role: 'TEAM', team_id: 'T02', participant_id: null };
const TEAM3 = { user_id: 6, email: 't03@test.local', role: 'TEAM', team_id: 'T03', participant_id: null };

before(async () => {
  const built = createApp();
  server = built.server;
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

beforeEach(async () => {
  await resetSchema();
  await seedUsers();

  // Extra team for cross-team ownership assertions.
  await pool.query(
    `INSERT INTO teams (team_id, team_name, registration_token, registration_status)
     VALUES ('T02', 'Second Team', 'cv-reg-test-token-2', 'REGISTERED'),
            ('T03', 'Third Team', 'cv-reg-test-token-3', 'UNREGISTERED')
     ON CONFLICT (team_id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO users (user_id, email, password_hash, role, team_id)
     VALUES ($1, $2, 'unused-test-hash', $3, $4)
     ON CONFLICT (user_id) DO NOTHING`,
    [TEAM2.user_id, TEAM2.email, TEAM2.role, TEAM2.team_id]
  );
  await pool.query(
    `INSERT INTO users (user_id, email, password_hash, role, team_id)
     VALUES ($1, $2, 'unused-test-hash', $3, $4)
     ON CONFLICT (user_id) DO NOTHING`,
    [TEAM3.user_id, TEAM3.email, TEAM3.role, TEAM3.team_id]
  );

  // Two games + results for T01 and T02 (T03 has none).
  await pool.query(
    `INSERT INTO games (name, description, status, route) VALUES
     ('Red Light Green Light', 'Code during GREEN. Stop during RED.', 'COMPLETED', 'rlgl'),
     ('Game Two', 'Second game.', 'UPCOMING', 'game-2')`
  );
  const { rows } = await pool.query(
    `SELECT game_id FROM games WHERE route = 'rlgl'`
  );
  const rlglId = rows[0].game_id;
  await pool.query(
    `INSERT INTO game_results (game_id, team_id, rank, score, time_seconds, status) VALUES
     ($1, 'T01', 1, 98, 340, 'WINNER'),
     ($1, 'T02', 2, 94, 420, 'QUALIFIED')`,
    [rlglId]
  );
});

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

async function getTeamResults(teamId, roleUser) {
  const res = await fetch(`${baseUrl}/teams/${teamId}/results`, {
    headers: auth(signToken(roleUser)),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

test('TEAM fetches its own results only', async () => {
  const { status, data } = await getTeamResults('T01', FIXTURES.team);
  assert.equal(status, 200);
  assert.equal(data.results.length, 1);
  assert.equal(data.results[0].team_id, 'T01');
  assert.equal(data.results[0].rank, 1);
  assert.equal(data.results[0].game_name, 'Red Light Green Light');
  assert.equal(data.results[0].result_status, 'WINNER');
});

test('TEAM cannot fetch another team\'s results (403)', async () => {
  // T02 has a result; the T01 team user must not see it.
  const { status, data } = await getTeamResults('T02', FIXTURES.team);
  assert.equal(status, 403);
  assert.equal(data.error.code, 'FORBIDDEN');
});

test('TEAM with no results gets an empty list', async () => {
  const { status, data } = await getTeamResults('T03', TEAM3);
  assert.equal(status, 200);
  assert.deepEqual(data.results, []);
});

test('PARTICIPANT sees own team results, forbidden from another team', async () => {
  const own = await getTeamResults('T01', FIXTURES.participant);
  assert.equal(own.status, 200);
  assert.equal(own.data.results.length, 1);
  assert.equal(own.data.results[0].team_id, 'T01');

  const other = await getTeamResults('T02', FIXTURES.participant);
  assert.equal(other.status, 403);
});

test('ADMIN and DEV may read any team\'s results', async () => {
  for (const roleUser of [FIXTURES.admin, FIXTURES.dev]) {
    const { status, data } = await getTeamResults('T02', roleUser);
    assert.equal(status, 200);
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].team_id, 'T02');
  }
});

test('TEAM GET /teams/:id enforces ownership', async () => {
  const own = await fetch(`${baseUrl}/teams/T01`, { headers: auth(signToken(FIXTURES.team)) });
  assert.equal(own.status, 200);
  const { team, participants } = await own.json();
  assert.equal(team.team_id, 'T01');
  assert.ok(Array.isArray(participants));

  const other = await fetch(`${baseUrl}/teams/T02`, { headers: auth(signToken(FIXTURES.team)) });
  assert.equal(other.status, 403);
});
