/**
 * Admin Participant Management integration tests (ADMIN/DEV only).
 *
 * Covers:
 *  - list includes leader + team registration status
 *  - ADMIN/DEV can view a participant's full detail (no password_hash/tokens)
 *  - PARTICIPANT is 403 everywhere on participant-management endpoints
 *  - editing name/email/phone (normalized), user-account sync on email change
 *  - duplicate emails rejected (participant + user account layers)
 *  - attempted team_id / is_leader tampering in PATCH is ignored
 *  - password reset (hashed, changes real login behavior, never echoed)
 *  - atomic leader change: exactly one leader, membership unchanged,
 *    registration state unchanged, team-wide Registration QR access intact
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

// Second member of T01 + its account, so leader/duplicate tests have a pair.
const P2 = { user_id: 5, email: 'p002@test.local', role: 'PARTICIPANT', team_id: 'T01', participant_id: 2 };

async function login(email, password) {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

async function api(token, method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

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
  // A second participant (and account) on T01.
  await pool.query(
    `INSERT INTO participants (participant_id, name, email, team_id)
     VALUES (2, 'Second Member', 'p002@test.local', 'T01')
     ON CONFLICT (participant_id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO users (user_id, email, password_hash, role, participant_id, team_id)
     VALUES ($1, $2, 'unused-test-hash', $3, $4, $5)
     ON CONFLICT (user_id) DO NOTHING`,
    [P2.user_id, P2.email, P2.role, P2.participant_id, P2.team_id]
  );
});

// ------------------------------------------------------------ list + view ----

test('participants: list exposes leader + team registration status', async () => {
  const { status, data } = await api(signToken(FIXTURES.admin), 'GET', '/participants');
  assert.equal(status, 200);
  const p1 = data.participants.find((p) => Number(p.participant_id) === 1);
  assert.ok(p1, 'participant 1 should be listed');
  assert.equal(p1.team_id, 'T01');
  assert.equal(p1.team_name, 'Test Team');
  assert.equal(p1.is_leader, false);
  assert.equal(p1.registration_status, 'UNREGISTERED');
  assert.equal(p1.password_hash, undefined);
});

test('participants: ADMIN and DEV can view full details without secrets', async () => {
  for (const roleUser of [FIXTURES.admin, FIXTURES.dev]) {
    const { status, data } = await api(signToken(roleUser), 'GET', '/participants/1');
    assert.equal(status, 200);
    assert.equal(data.participant.name, 'Test Participant');
    assert.equal(data.participant.email, 'p001@test.local');
    assert.equal(data.participant.team_id, 'T01');
    assert.equal(data.participant.team_name, 'Test Team');
    assert.equal(data.participant.is_leader, false);
    assert.equal(data.participant.password_hash, undefined, 'never expose password_hash');
    assert.equal(data.participant.token, undefined, 'never expose tokens');
    assert.equal(data.participant.registration_token, undefined, 'never expose QR secrets');
  }
});

test('participants: PARTICIPANT gets 403 on every participant-management endpoint', async () => {
  const token = signToken(FIXTURES.participant);
  const checks = [
    ['GET', '/participants'],
    ['GET', '/participants/1'],
    ['PATCH', '/participants/1'],
    ['POST', '/participants/2/reset-password'],
    ['POST', '/participants/1/make-leader'],
  ];
  for (const [method, path] of checks) {
    const body = method === 'PATCH' ? { name: 'X', email: 'x@test.local' }
      : method.includes('reset-password') ? { password: 'brandnew123' } : undefined;
    const { status } = await api(token, method, path, body);
    assert.equal(status, 403, `${method} ${path}`);
  }
});

test('participants: unknown / invalid ids are handled (404/400)', async () => {
  const admin = signToken(FIXTURES.admin);
  for (const path of ['/participants/999', '/participants/999/reset-password', '/participants/999/make-leader']) {
    const { status } = await api(admin, path.startsWith('/participants/999/') && path.endsWith('reset-password') ? 'POST' : path.endsWith('make-leader') ? 'POST' : 'GET', path, path.includes('reset-password') ? { password: 'brandnew123' } : undefined);
    assert.equal(status, 404, path);
  }
  const bad = await api(admin, 'GET', '/participants/abc');
  assert.equal(bad.status, 400);
});

// ---------------------------------------------------------------- editing ----

test('participants: ADMIN edits name (and phone) without touching identity', async () => {
  const { status, data } = await api(signToken(FIXTURES.admin), 'PATCH', '/participants/1', {
    name: 'Renamed Participant',
    email: 'p001@test.local',
    phone: '9000000111',
  });
  assert.equal(status, 200);
  assert.equal(data.participant.name, 'Renamed Participant');
  assert.equal(data.participant.phone, '9000000111');
  assert.equal(data.participant.team_id, 'T01');

  const { rows } = await pool.query('SELECT name FROM participants WHERE participant_id = 1');
  assert.equal(rows[0].name, 'Renamed Participant');
});

test('participants: email edit is normalized and syncs the linked user account atomically', async () => {
  const { status, data } = await api(signToken(FIXTURES.dev), 'PATCH', '/participants/1', {
    name: 'Test Participant',
    email: '  P001-NEW@TEST.LOCAL  ',
  });
  assert.equal(status, 200);
  assert.equal(data.participant.email, 'p001-new@test.local');

  const participants = await pool.query('SELECT email FROM participants WHERE participant_id = 1');
  const users = await pool.query(
    'SELECT email FROM users WHERE user_id = $1',
    [FIXTURES.participant.user_id]
  );
  assert.equal(participants.rows[0].email, 'p001-new@test.local');
  assert.equal(users.rows[0].email, 'p001-new@test.local');
});

test('participants: duplicate emails are rejected and nothing changes', async () => {
  const admin = signToken(FIXTURES.admin);
  // (a) collides with another participant's email (idx_participants_email)
  const dup = await api(admin, 'PATCH', '/participants/1', {
    name: 'Test Participant',
    email: 'p002@test.local',
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.error.code, 'DUPLICATE_EMAIL');

  // (b) participant email change that would collide with an existing ACCOUNT
  // email (users_email_key) when the linked account mirrors the old email.
  const dupUser = await api(admin, 'PATCH', '/participants/1', {
    name: 'Test Participant',
    email: 'admin@test.local',
  });
  assert.equal(dupUser.status, 409);
  assert.equal(dupUser.data.error.code, 'DUPLICATE_EMAIL');

  // Both rows untouched.
  const participants = await pool.query('SELECT email FROM participants WHERE participant_id = 1');
  const users = await pool.query('SELECT email FROM users WHERE participant_id = 1');
  assert.equal(participants.rows[0].email, 'p001@test.local');
  assert.equal(users.rows[0].email, 'p001@test.local');
});

test('participants: team_id / is_leader / role cannot be tampered via PATCH', async () => {
  const { status } = await api(signToken(FIXTURES.admin), 'PATCH', '/participants/1', {
    name: 'Test Participant',
    email: 'p001@test.local',
    team_id: 'T999',
    is_leader: true,
    role: 'ADMIN',
  });
  assert.equal(status, 200);

  const { rows } = await pool.query(
    'SELECT team_id, is_leader FROM participants WHERE participant_id = 1'
  );
  assert.equal(rows[0].team_id, 'T01');
  assert.equal(rows[0].is_leader, false);

  const users = await pool.query('SELECT role FROM users WHERE participant_id = 1');
  assert.equal(users.rows[0].role, 'PARTICIPANT');
});

// -------------------------------------------------------- password reset ----

test('participants: ADMIN password reset hashes the password and changes login behavior', async () => {
  // Participant 2's account starts with an unusable test hash.
  const res = await api(signToken(FIXTURES.admin), 'POST', '/participants/2/reset-password', {
    password: 'brandnew123',
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.password, undefined, 'password must never be echoed');

  // Stored hashed (bcrypt), never plaintext.
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE user_id = $1', [P2.user_id]);
  assert.notEqual(rows[0].password_hash, 'brandnew123');
  assert.ok(rows[0].password_hash.startsWith('$2'), 'must be a bcrypt hash');
  const { default: bcrypt } = await import('bcryptjs');
  assert.equal(await bcrypt.compare('brandnew123', rows[0].password_hash), true);

  // The real login path now accepts the new password.
  const loginRes = await login('p002@test.local', 'brandnew123');
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.data.user.role, 'PARTICIPANT');
});

test('participants: short/weak passwords are rejected for reset', async () => {
  const { status, data } = await api(signToken(FIXTURES.admin), 'POST', '/participants/2/reset-password', {
    password: '12345',
  });
  assert.equal(status, 400);
  assert.equal(data.error.code, 'INVALID_PASSWORD');
});

// --------------------------------------------------------- leader change ----

test('participants: ADMIN can atomically change the team leader', async () => {
  const res = await api(signToken(FIXTURES.admin), 'POST', '/participants/2/make-leader');
  assert.equal(res.status, 200);
  assert.equal(res.data.participant.is_leader, true);

  // Exactly one leader on T01, the new one.
  const { rows } = await pool.query(
    `SELECT participant_id, is_leader, team_id FROM participants WHERE team_id = 'T01' ORDER BY participant_id`
  );
  assert.deepEqual(
    rows.map((r) => [Number(r.participant_id), r.is_leader, r.team_id]),
    [
      [1, false, 'T01'],
      [2, true, 'T01'],
    ]
  );
  const leaders = await pool.query(
    `SELECT COUNT(*)::int AS n FROM participants WHERE team_id = 'T01' AND is_leader`
  );
  assert.equal(leaders.rows[0].n, 1);

  // Registration/check-in state untouched.
  const teams = await pool.query('SELECT registration_status FROM teams WHERE team_id = $1', ['T01']);
  assert.equal(teams.rows[0].registration_status, 'UNREGISTERED');
});

test('participants: leader can be moved back and stays single', async () => {
  await api(signToken(FIXTURES.dev), 'POST', '/participants/2/make-leader');
  const back = await api(signToken(FIXTURES.admin), 'POST', '/participants/1/make-leader');
  assert.equal(back.status, 200);
  assert.equal(back.data.participant.is_leader, true);

  const { rows } = await pool.query(
    `SELECT participant_id, is_leader FROM participants WHERE team_id = 'T01' ORDER BY participant_id`
  );
  assert.deepEqual(
    rows.map((r) => [Number(r.participant_id), r.is_leader]),
    [
      [1, true],
      [2, false],
    ]
  );
});

test('participants: Registration QR stays accessible to every member after a leader change', async () => {
  await api(signToken(FIXTURES.admin), 'POST', '/participants/2/make-leader');

  // P1 is now a NON-leader; P2 is the leader. Both get the same team QR.
  const token = 'cv-reg-test-token'; // teams.registration_token seeded by helpers
  const p1Qr = await api(signToken(FIXTURES.participant), 'GET', '/teams/T01/qr');
  assert.equal(p1Qr.status, 200);
  assert.equal(p1Qr.data.token, token);

  const p2Qr = await api(signToken(P2), 'GET', '/teams/T01/qr');
  assert.equal(p2Qr.status, 200);
  assert.equal(p2Qr.data.token, token);

  const adminQr = await api(signToken(FIXTURES.admin), 'GET', '/teams/T01/qr');
  assert.equal(adminQr.status, 200);
  assert.equal(adminQr.data.token, token);
});
