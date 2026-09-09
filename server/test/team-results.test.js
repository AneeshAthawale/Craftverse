/**
 * Team Dashboard backend tests (participant-scoped).
 *
 * Covers the `GET /teams/:id/results` ownership endpoint:
 *  - PARTICIPANT sees only their own team's results
 *  - PARTICIPANT is forbidden from another team's results
 *  - ADMIN/DEV may read any team's results
 *  - GET /teams/:id ownership is enforced for PARTICIPANT
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

// PARTICIPANT accounts on T02/T03 (each team needs a participant row first).
const P2 = { user_id: 5, email: 'p002@test.local', role: 'PARTICIPANT', team_id: 'T02', participant_id: 2 };
const P3 = { user_id: 6, email: 'p003@test.local', role: 'PARTICIPANT', team_id: 'T03', participant_id: 3 };

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

  // Extra teams + their participant members for cross-team ownership assertions.
  await pool.query(
    `INSERT INTO teams (team_id, team_name, registration_token, registration_status)
     VALUES ('T02', 'Second Team', 'cv-reg-test-token-2', 'REGISTERED'),
            ('T03', 'Third Team', 'cv-reg-test-token-3', 'UNREGISTERED')
     ON CONFLICT (team_id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO participants (participant_id, name, email, team_id) VALUES
     (2, 'Second Participant', 'p002@test.local', 'T02'),
     (3, 'Third Participant', 'p003@test.local', 'T03')
     ON CONFLICT (participant_id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO users (user_id, email, password_hash, role, participant_id, team_id)
     VALUES ($1, $2, 'unused-test-hash', $3, $4, $5)
     ON CONFLICT (user_id) DO NOTHING`,
    [P2.user_id, P2.email, P2.role, P2.participant_id, P2.team_id]
  );
  await pool.query(
    `INSERT INTO users (user_id, email, password_hash, role, participant_id, team_id)
     VALUES ($1, $2, 'unused-test-hash', $3, $4, $5)
     ON CONFLICT (user_id) DO NOTHING`,
    [P3.user_id, P3.email, P3.role, P3.participant_id, P3.team_id]
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

test('PARTICIPANT fetches their own team\'s results only', async () => {
  // T02's participant sees T02's result.
  const { status, data } = await getTeamResults('T02', P2);
  assert.equal(status, 200);
  assert.equal(data.results.length, 1);
  assert.equal(data.results[0].team_id, 'T02');
  assert.equal(data.results[0].rank, 2);
  assert.equal(data.results[0].game_name, 'Red Light Green Light');
  assert.equal(data.results[0].result_status, 'QUALIFIED');

  // T01's fixture participant sees T01's result.
  const own = await getTeamResults('T01', FIXTURES.participant);
  assert.equal(own.status, 200);
  assert.equal(own.data.results.length, 1);
  assert.equal(own.data.results[0].team_id, 'T01');
  assert.equal(own.data.results[0].result_status, 'WINNER');
});

test('PARTICIPANT cannot fetch another team\'s results (403)', async () => {
  // T02 has a result; the T01 participant must not see it.
  const { status, data } = await getTeamResults('T02', FIXTURES.participant);
  assert.equal(status, 403);
  assert.equal(data.error.code, 'FORBIDDEN');
});

test('PARTICIPANT with no results gets an empty list', async () => {
  const { status, data } = await getTeamResults('T03', P3);
  assert.equal(status, 200);
  assert.deepEqual(data.results, []);
});

test('ADMIN and DEV may read any team\'s results', async () => {
  for (const roleUser of [FIXTURES.admin, FIXTURES.dev]) {
    const { status, data } = await getTeamResults('T02', roleUser);
    assert.equal(status, 200);
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].team_id, 'T02');
  }
});

test('PARTICIPANT GET /teams/:id enforces ownership', async () => {
  const own = await fetch(`${baseUrl}/teams/T01`, { headers: auth(signToken(FIXTURES.participant)) });
  assert.equal(own.status, 200);
  const { team, participants } = await own.json();
  assert.equal(team.team_id, 'T01');
  assert.ok(Array.isArray(participants));

  const other = await fetch(`${baseUrl}/teams/T02`, { headers: auth(signToken(FIXTURES.participant)) });
  assert.equal(other.status, 403);
});
