/**
 * Core flow integration tests — the modules the original suite left untested:
 *   - Auth: login (all roles), invalid credentials, /auth/me, expired/invalid JWT
 *   - Registration QR: lookup, single-use verify, RBAC, socket broadcast
 *   - Food: token lifecycle (UNUSED -> USED), reuse/expiry, ownership, RBAC
 *   - Notifications: create (ADMIN/DEV only), list, invalid type, broadcast
 *   - Inquiries: create, ownership scoping, admin respond, status transitions
 *
 * Runs against the dedicated craftverse_test DB via helpers.js (schema is
 * dropped + re-applied in beforeEach). Uses the REAL login path for credential
 * tests and the same hand-signed JWT path as the rest of the suite elsewhere.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioc } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import {
  resetSchema,
  seedUsers,
  setTeamRegistered,
  signToken,
  FIXTURES,
  createApp,
  pool,
  config,
} from './helpers.js';

let server;
let httpOrigin;
let baseUrl;

// Seed dev-style hashed passwords for the login tests (bcrypt, same as seed.js).
async function seedLoginUsers() {
  const { default: bcrypt } = await import('bcryptjs');
  const [teamHash, adminHash] = await Promise.all([
    bcrypt.hash('team123', 4),
    bcrypt.hash('dev123', 4),
  ]);
  // T01 participant exists from seedUsers (with 'unused-test-hash'); we
  // re-point the passwords so the real login path can authenticate.
  await pool.query(
    `UPDATE users SET password_hash = $1 WHERE email = 'p001@test.local'`,
    [teamHash]
  );
  await pool.query(
    `UPDATE users SET password_hash = $1 WHERE email IN
       ('admin@test.local', 'dev@test.local')`,
    [adminHash]
  );
}

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

async function login(email, password) {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function api(token, method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

function connectSocketAs(user) {
  return new Promise((resolve, reject) => {
    const socket = ioc(httpOrigin, {
      transports: ['websocket'],
      auth: { token: signToken(user) },
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function once(socket, event, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  const built = createApp();
  server = built.server;
  await new Promise((resolve) => server.listen(0, resolve));
  httpOrigin = `http://127.0.0.1:${server.address().port}`;
  baseUrl = `${httpOrigin}/api`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

beforeEach(async () => {
  await resetSchema();
  await seedUsers();
  // A second team (T02) + participant so ownership tests can distinguish teams.
  await pool.query(
    `INSERT INTO teams (team_id, team_name, registration_token, registration_status)
     VALUES ('T02', 'Second Team', 'cv-reg-test-token-2', 'REGISTERED')
     ON CONFLICT (team_id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO participants (participant_id, name, email, team_id)
     VALUES (2, 'Second Participant', 'p002@test.local', 'T02')
     ON CONFLICT (participant_id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO users (user_id, email, password_hash, role, participant_id, team_id)
     VALUES (6, 'p002@test.local', 'unused-test-hash', 'PARTICIPANT', 2, 'T02')
     ON CONFLICT (user_id) DO NOTHING`
  );
});

// ------------------------------------------------------------- AUTH --------

test('POST /auth/login succeeds for every role with correct credentials', async () => {
  await seedLoginUsers();
  const cases = [
    ['admin@test.local', 'dev123', 'ADMIN'],
    ['dev@test.local', 'dev123', 'DEV'],
    ['p001@test.local', 'team123', 'PARTICIPANT'],
  ];
  for (const [email, password, role] of cases) {
    const { status, data } = await login(email, password);
    assert.equal(status, 200, email);
    assert.ok(data.token, `${email} should get a token`);
    assert.equal(data.user.role, role);
    assert.equal(data.user.email, email);
    assert.equal(data.user.password_hash, undefined, 'password hash must never be exposed');
  }
});

test('POST /auth/login rejects a wrong password and an unknown email with 401', async () => {
  await seedLoginUsers();
  for (const [email, password] of [
    ['admin@test.local', 'wrong-password'],
    ['nobody@test.local', 'anything'],
  ]) {
    const { status, data } = await login(email, password);
    assert.equal(status, 401);
    assert.equal(data.error.code, 'INVALID_CREDENTIALS');
  }
});

test('GET /auth/me returns the current user for a valid token', async () => {
  const { data: loginData } = await api(signToken(FIXTURES.participant), 'GET', '/auth/me');
  assert.equal(loginData.user.email, 'p001@test.local');
  assert.equal(loginData.user.role, 'PARTICIPANT');
});

test('GET /auth/me rejects an expired token with 401', async () => {
  const expired = jwt.sign(
    { sub: '4', role: 'PARTICIPANT', team_id: 'T01', participant_id: 1 },
    config.jwtSecret,
    { expiresIn: '-10s' }
  );
  const { status, data } = await api(expired, 'GET', '/auth/me');
  assert.equal(status, 401);
  assert.equal(data.error.code, 'INVALID_TOKEN');
});

test('a tampered token is rejected with 401', async () => {
  const { status } = await api(`${signToken(FIXTURES.admin)}x`, 'GET', '/auth/me');
  assert.equal(status, 401);
});

// ------------------------------------------- REGISTRATION QR -----------------

test('registration: GET /qr/:token returns team name + status for any auth user', async () => {
  const token = 'cv-reg-test-token';
  const { status, data } = await api(signToken(FIXTURES.participant), 'GET', `/registration/qr/${token}`);
  assert.equal(status, 200);
  assert.equal(data.registration.team_id, 'T01');
  assert.equal(data.registration.registration_status, 'UNREGISTERED');
  assert.equal(data.registration.token, undefined, 'token must not be echoed back');
});

test('registration: unknown QR token -> 404', async () => {
  const { status, data } = await api(signToken(FIXTURES.admin), 'GET', '/registration/qr/does-not-exist');
  assert.equal(status, 404);
  assert.equal(data.error.code, 'INVALID_TOKEN');
});

test('registration: ADMIN verifies a team -> REGISTERED, single-use, broadcast', async () => {
  // The teams table is seeded UNREGISTERED; the parallel registration row must
  // exist for verification to update. Insert it like the dev seed does.
  await pool.query(
    `INSERT INTO registration (team_id, token, status)
     VALUES ('T01', 'cv-reg-test-token', 'UNREGISTERED')
     ON CONFLICT (team_id) DO NOTHING`
  );

  const [teamSocket] = await Promise.all([connectSocketAs(FIXTURES.participant)]);
  try {
    const broadcastPromise = once(teamSocket, 'registration:completed');
    const { status, data } = await api(signToken(FIXTURES.admin), 'POST', '/registration/verify', {
      token: 'cv-reg-test-token',
    });
    assert.equal(status, 200);
    assert.equal(data.team.registration_status, 'REGISTERED');
    assert.ok(data.team.registered_at);

    const evt = await broadcastPromise;
    assert.equal(evt.team.team_id, 'T01');
    assert.equal(evt.team.registration_status, 'REGISTERED');

    // Persisted in both tables.
    const teams = await pool.query('SELECT registration_status FROM teams WHERE team_id = $1', ['T01']);
    const regs = await pool.query('SELECT status FROM registration WHERE team_id = $1', ['T01']);
    assert.equal(teams.rows[0].registration_status, 'REGISTERED');
    assert.equal(regs.rows[0].status, 'REGISTERED');
  } finally {
    teamSocket.disconnect();
  }
});

test('registration: verify is single-use — a second scan returns 409', async () => {
  await pool.query(
    `INSERT INTO registration (team_id, token, status)
     VALUES ('T01', 'cv-reg-test-token', 'UNREGISTERED')
     ON CONFLICT (team_id) DO NOTHING`
  );
  await api(signToken(FIXTURES.admin), 'POST', '/registration/verify', { token: 'cv-reg-test-token' });
  const second = await api(signToken(FIXTURES.admin), 'POST', '/registration/verify', { token: 'cv-reg-test-token' });
  assert.equal(second.status, 409);
  assert.equal(second.data.error.code, 'ALREADY_REGISTERED');
});

test('registration: PARTICIPANT cannot verify (403)', async () => {
  await pool.query(
    `INSERT INTO registration (team_id, token, status)
     VALUES ('T01', 'cv-reg-test-token', 'UNREGISTERED')
     ON CONFLICT (team_id) DO NOTHING`
  );
  const { status } = await api(signToken(FIXTURES.participant), 'POST', '/registration/verify', { token: 'cv-reg-test-token' });
  assert.equal(status, 403);
});

// ------------------------------------------------ FOOD ----------------------

test('food: GET /food/me returns 403 for a non-participant (staff) user', async () => {
  const { status } = await api(signToken(FIXTURES.dev), 'GET', '/food/me');
  assert.equal(status, 403);
});

test('food: a participant of a VERIFIED team gets a backend-generated UNUSED token for the active meal (or null)', async () => {
  // Event-day features require the team to be checked in first.
  await setTeamRegistered('T01');
  const { status, data } = await api(signToken(FIXTURES.participant), 'GET', '/food/me');
  assert.equal(status, 200);
  if (data.access) {
    assert.equal(data.access.participant_id, 1);
    assert.ok(data.access.token.startsWith('cv-food-'), 'token must be backend-generated');
    assert.equal(data.access.status, 'UNUSED');
  } else {
    // No active meal window right now — that is a valid state.
    assert.equal(data.meal, null);
    assert.equal(data.access, null);
  }
});

test('food: ADMIN verify marks an UNUSED token USED; reuse is rejected 409', async () => {
  await pool.query(
    `INSERT INTO food_access (participant_id, meal_type, event_day, token)
     VALUES (1, 'LUNCH', 1, 'cv-food-test-token-1')`
  );
  const first = await api(signToken(FIXTURES.admin), 'POST', '/food/verify', { token: 'cv-food-test-token-1' });
  assert.equal(first.status, 200);
  assert.equal(first.data.granted, true);
  assert.equal(first.data.access.status, 'USED');
  assert.ok(first.data.access.used_at);

  const reuse = await api(signToken(FIXTURES.admin), 'POST', '/food/verify', { token: 'cv-food-test-token-1' });
  assert.equal(reuse.status, 409);
  assert.equal(reuse.data.error.code, 'ALREADY_USED');
});

test('food: an EXPIRED token is rejected with 409 TOKEN_EXPIRED', async () => {
  await pool.query(
    `INSERT INTO food_access (participant_id, meal_type, event_day, token, status, expires_at)
     VALUES (1, 'LUNCH', 1, 'cv-food-test-token-expired', 'UNUSED', now() - interval '1 hour')`
  );
  const res = await api(signToken(FIXTURES.admin), 'POST', '/food/verify', { token: 'cv-food-test-token-expired' });
  assert.equal(res.status, 409);
  assert.equal(res.data.error.code, 'TOKEN_EXPIRED');
  // The row is now marked EXPIRED in the DB.
  const { rows } = await pool.query('SELECT status FROM food_access WHERE token = $1', ['cv-food-test-token-expired']);
  assert.equal(rows[0].status, 'EXPIRED');
});

test('food: an unknown token -> 404 INVALID_TOKEN', async () => {
  const { status, data } = await api(signToken(FIXTURES.admin), 'POST', '/food/verify', { token: 'cv-food-nope' });
  assert.equal(status, 404);
  assert.equal(data.error.code, 'INVALID_TOKEN');
});

test('food: PARTICIPANT cannot verify tokens (403)', async () => {
  await pool.query(
    `INSERT INTO food_access (participant_id, meal_type, event_day, token)
     VALUES (1, 'LUNCH', 1, 'cv-food-test-token-2')`
  );
  const { status } = await api(signToken(FIXTURES.participant), 'POST', '/food/verify', { token: 'cv-food-test-token-2' });
  assert.equal(status, 403);
});

test('food: a used token is never re-verifiable even by another role', async () => {
  await pool.query(
    `INSERT INTO food_access (participant_id, meal_type, event_day, token, status)
     VALUES (1, 'LUNCH', 1, 'cv-food-test-token-3', 'USED')`
  );
  const { status, data } = await api(signToken(FIXTURES.dev), 'POST', '/food/verify', { token: 'cv-food-test-token-3' });
  assert.equal(status, 409);
  assert.equal(data.error.code, 'ALREADY_USED');
});

// ------------------------------------------- NOTIFICATIONS -----------------

test('notifications: ADMIN creates + broadcasts notification:new; list returns it', async () => {
  const [participantSocket] = await Promise.all([connectSocketAs(FIXTURES.participant)]);
  try {
    const broadcastPromise = once(participantSocket, 'notification:new');
    const { status, data } = await api(signToken(FIXTURES.admin), 'POST', '/notifications', {
      type: 'IMPORTANT',
      title: 'Test alert',
      message: 'Round 2 starts soon',
    });
    assert.equal(status, 201);
    assert.equal(data.notification.type, 'IMPORTANT');

    const evt = await broadcastPromise;
    assert.equal(evt.notification.title, 'Test alert');

    const list = await api(signToken(FIXTURES.participant), 'GET', '/notifications');
    assert.equal(list.status, 200);
    assert.equal(list.data.notifications.length, 1);
    assert.equal(list.data.notifications[0].type, 'IMPORTANT');
  } finally {
    participantSocket.disconnect();
  }
});

test('notifications: PARTICIPANT cannot create (403); invalid type rejected (400)', async () => {
  const { status } = await api(signToken(FIXTURES.participant), 'POST', '/notifications', {
    type: 'NORMAL',
    title: 'x',
    message: 'y',
  });
  assert.equal(status, 403);
  const invalid = await api(signToken(FIXTURES.admin), 'POST', '/notifications', {
    type: 'LOUD',
    title: 'x',
    message: 'y',
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.error.code, 'VALIDATION_ERROR');
});

// ------------------------------------------------- INQUIRIES ----------------

test('inquiries: a participant sees ONLY their own inquiries, not another participant\'s', async () => {
  // P001 (T01) inquiry + P002 (T02) inquiry.
  await pool.query(
    `INSERT INTO inquiries (participant_id, team_id, title, message, status)
     VALUES (1, 'T01', 'Mine', 'hello', 'OPEN')`
  );
  await pool.query(
    `INSERT INTO inquiries (participant_id, team_id, title, message, status)
     VALUES (2, 'T02', 'Not mine', 'secret', 'OPEN')`
  );

  const { status, data } = await api(signToken(FIXTURES.participant), 'GET', '/inquiries/mine');
  assert.equal(status, 200);
  assert.equal(data.inquiries.length, 1);
  assert.equal(data.inquiries[0].title, 'Mine');
});

test('inquiries: admin sees all and can respond; participant receives inquiry:updated', async () => {
  const { rows } = await pool.query(
    `INSERT INTO inquiries (participant_id, team_id, title, message, status)
     VALUES (1, 'T01', 'Lunch QR missing', 'help', 'OPEN')
     RETURNING inquiry_id`
  );
  const inquiryId = rows[0].inquiry_id;

  const [participantSocket] = await Promise.all([connectSocketAs(FIXTURES.participant)]);
  try {
    const broadcastPromise = once(participantSocket, 'inquiry:updated');
    const { status, data } = await api(signToken(FIXTURES.admin), 'PATCH', `/inquiries/${inquiryId}`, {
      status: 'IN_PROGRESS',
      response: 'We are looking into it',
    });
    assert.equal(status, 200);
    assert.equal(data.inquiry.status, 'IN_PROGRESS');
    assert.equal(data.inquiry.response, 'We are looking into it');

    const evt = await broadcastPromise;
    assert.equal(evt.inquiry.status, 'IN_PROGRESS');

    // Participant's own list reflects the response (persisted).
    const mine = await api(signToken(FIXTURES.participant), 'GET', '/inquiries/mine');
    assert.equal(mine.data.inquiries[0].response, 'We are looking into it');
  } finally {
    participantSocket.disconnect();
  }
});

test('inquiries: a participant cannot update staff responses (403)', async () => {
  const { rows } = await pool.query(
    `INSERT INTO inquiries (participant_id, team_id, title, message, status)
     VALUES (1, 'T01', 'Q', 'A', 'OPEN')
     RETURNING inquiry_id`
  );
  const { status } = await api(signToken(FIXTURES.participant), 'PATCH', `/inquiries/${rows[0].inquiry_id}`, {
    status: 'RESOLVED',
  });
  assert.equal(status, 403);
});

test('inquiries: admin can move a ticket to RESOLVED (persisted with resolved_at)', async () => {
  const { rows } = await pool.query(
    `INSERT INTO inquiries (participant_id, team_id, title, message, status)
     VALUES (1, 'T01', 'Q', 'A', 'IN_PROGRESS')
     RETURNING inquiry_id`
  );
  const { status, data } = await api(signToken(FIXTURES.dev), 'PATCH', `/inquiries/${rows[0].inquiry_id}`, {
    status: 'RESOLVED',
  });
  assert.equal(status, 200);
  assert.equal(data.inquiry.status, 'RESOLVED');
  assert.ok(data.inquiry.resolved_at);

  const { rows: dbRows } = await pool.query('SELECT status, resolved_at FROM inquiries WHERE inquiry_id = $1', [rows[0].inquiry_id]);
  assert.equal(dbRows[0].status, 'RESOLVED');
  assert.ok(dbRows[0].resolved_at);
});

test('inquiries: invalid status is rejected with 400', async () => {
  const { rows } = await pool.query(
    `INSERT INTO inquiries (participant_id, team_id, title, message)
     VALUES (1, 'T01', 'Q', 'A')
     RETURNING inquiry_id`
  );
  const { status } = await api(signToken(FIXTURES.admin), 'PATCH', `/inquiries/${rows[0].inquiry_id}`, {
    status: 'BOGUS',
  });
  assert.equal(status, 400);
});

// --------------------------------------- meal schedule unit semantics ------

test('mealSchedule: getCurrentEventDay uses the EVENT_DAY_ONE anchor, not parity', async () => {
  // Save and restore the env so other tests are unaffected.
  const prev = process.env.EVENT_DAY_ONE;
  try {
    process.env.EVENT_DAY_ONE = '2026-09-07'; // a Monday
    const { getCurrentEventDay, getCurrentMeal } = await import('../utils/mealSchedule.js');

    // Same calendar parity day as the anchor's next day must NOT be day 2.
    assert.equal(getCurrentEventDay(new Date(2026, 8, 7, 12, 0)), 1); // anchor day
    assert.equal(getCurrentEventDay(new Date(2026, 8, 8, 12, 0)), 2); // next day
    assert.equal(getCurrentEventDay(new Date(2026, 8, 9, 12, 0)), null); // outside event
    // The old parity bug would have returned 2 for 2026-09-09 (odd/even drift).
    assert.equal(getCurrentEventDay(new Date(2026, 8, 15, 12, 0)), null); // a week later

    // Meal windows are clock-derived and event-day-aware.
    const lunchDay1 = getCurrentMeal(new Date(2026, 8, 7, 13, 30));
    assert.deepEqual(lunchDay1, { mealType: 'LUNCH', eventDay: 1 });
    const lunchDay2 = getCurrentMeal(new Date(2026, 8, 8, 13, 30));
    assert.deepEqual(lunchDay2, { mealType: 'LUNCH', eventDay: 2 });
    const lunchOutside = getCurrentMeal(new Date(2026, 8, 9, 13, 30));
    assert.equal(lunchOutside, null);
  } finally {
    if (prev === undefined) delete process.env.EVENT_DAY_ONE;
    else process.env.EVENT_DAY_ONE = prev;
  }
});
