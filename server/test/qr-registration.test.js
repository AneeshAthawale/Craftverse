/**
 * Registration QR — focused gap tests (Phase A of the QR system work).
 *
 * registration.test.js already covers the happy path, single-use verify,
 * staff-only verify, per-member QR access and the team-room broadcast. This
 * file adds only the cases that were NOT covered:
 *
 *  - verify response carries a member_count (for the scanner success screen)
 *  - unauthenticated QR fetch is rejected
 *  - QR tokens are unpredictable / not derivable from identifiers
 *  - wrong QR type is rejected in BOTH directions (registration <-> food)
 *  - checking in one team leaves unrelated teams locked
 *  - the registration:completed payload carries REGISTERED + member_count
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioc } from 'socket.io-client';
import {
  resetSchema,
  seedUsers,
  signToken,
  FIXTURES,
  createApp,
  pool,
} from './helpers.js';

let server;
let httpOrigin;
let baseUrl;

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

async function api(token, method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? auth(token) : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function login(email, password) {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const TEAM_PASSWORD = 'teamsecret';

/** A leader + two members -> team of 3. */
function regPayload(overrides = {}) {
  return {
    teamName: 'QR Gaps Team',
    leader: { name: 'Rahul Kumar', email: 'rahul@p.test' },
    members: [
      { name: 'Amit Singh', email: 'amit@p.test' },
      { name: 'Neha Gupta', email: 'neha@p.test' },
    ],
    password: TEAM_PASSWORD,
    ...overrides,
  };
}

async function getTeamToken(teamId) {
  const { rows } = await pool.query(
    'SELECT registration_token FROM teams WHERE team_id = $1',
    [teamId]
  );
  return rows[0].registration_token;
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = ioc(httpOrigin, { transports: ['websocket'], auth: { token } });
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
});

// ---------------------------------------------------------- member_count ----

test('qr: verify response reports the checked-in team member count', async () => {
  await api(null, 'POST', '/registration', regPayload());
  const token = await getTeamToken('T02');

  const verified = await api(signToken(FIXTURES.admin), 'POST', '/registration/verify', { token });
  assert.equal(verified.status, 200, `verify failed: ${JSON.stringify(verified.data)}`);
  assert.equal(verified.data.team.team_id, 'T02');
  assert.equal(verified.data.team.registration_status, 'REGISTERED');
  assert.equal(verified.data.team.member_count, 3);

  // A single-member team reports 1 (no off-by-one).
  await api(null, 'POST', '/registration', regPayload({
    teamName: 'Solo Team',
    leader: { name: 'Solo', email: 'solo@p.test' },
    members: [],
  }));
  const soloToken = await getTeamToken('T03');
  const solo = await api(signToken(FIXTURES.admin), 'POST', '/registration/verify', { token: soloToken });
  assert.equal(solo.status, 200);
  assert.equal(solo.data.team.member_count, 1);
});

// ------------------------------------------------------- access control -----

test('qr: fetching a team QR without authentication is rejected', async () => {
  const anon = await api(null, 'GET', '/teams/T01/qr');
  assert.equal(anon.status, 401);

  const dev = await api(signToken(FIXTURES.dev), 'GET', '/teams/T01/qr');
  assert.equal(dev.status, 200);
  assert.equal(dev.data.team_id, 'T01');
});

// --------------------------------------------------------- token secrecy ----

test('qr: registration tokens are unpredictable and expose no identifiers', async () => {
  await api(null, 'POST', '/registration', regPayload());
  await api(null, 'POST', '/registration', regPayload({
    teamName: 'Another Team',
    leader: { name: 'Boss', email: 'boss@p.test' },
    members: [],
  }));

  const t02 = await getTeamToken('T02');
  const t03 = await getTeamToken('T03');

  // Same team prefix, but the secret suffix differs between teams.
  assert.ok(t02.startsWith('cv-reg-T02-'));
  assert.ok(t03.startsWith('cv-reg-T03-'));
  assert.notEqual(t02, t03);
  assert.notEqual(t02.slice('cv-reg-T02-'.length), t03.slice('cv-reg-T03-'.length));

  // The random suffix is long and carries no email/password material.
  const suffix = t02.slice('cv-reg-T02-'.length);
  assert.equal(suffix.length, 16);
  assert.ok(!t02.includes('rahul@p.test'));
  assert.ok(!t02.includes(TEAM_PASSWORD));
});

// ------------------------------------------------------- wrong QR type ------

test('qr: a food token is rejected by the registration verifier (and vice versa)', async () => {
  // A valid-looking food token for the seeded participant.
  await pool.query(
    `INSERT INTO food_access (participant_id, meal_type, event_day, token)
     VALUES (1, 'LUNCH', 1, 'cv-food-cross-token')`
  );

  const asRegistration = await api(signToken(FIXTURES.admin), 'POST', '/registration/verify', {
    token: 'cv-food-cross-token',
  });
  assert.equal(asRegistration.status, 404);
  assert.equal(asRegistration.data.error.code, 'INVALID_TOKEN');

  // And a registration token cannot be consumed as a food token.
  const asFood = await api(signToken(FIXTURES.admin), 'POST', '/food/verify', {
    token: 'cv-reg-test-token',
  });
  assert.equal(asFood.status, 404);
  assert.equal(asFood.data.error.code, 'INVALID_TOKEN');
});

// ------------------------------------------------- unrelated team stays -----

test('qr: checking in one team leaves every other team locked', async () => {
  await api(null, 'POST', '/registration', regPayload());
  const token = await getTeamToken('T02');

  const member = await login('amit@p.test', TEAM_PASSWORD);
  assert.equal(member.status, 200);

  // Before check-in, the T02 member is locked.
  const beforeFood = await api(member.data.token, 'GET', '/food/me');
  assert.equal(beforeFood.status, 403);
  assert.equal(beforeFood.data.error.code, 'TEAM_NOT_VERIFIED');

  const verified = await api(signToken(FIXTURES.admin), 'POST', '/registration/verify', { token });
  assert.equal(verified.status, 200);

  // T02 unlocks; the unrelated seeded T01 participant is still locked.
  const afterFood = await api(member.data.token, 'GET', '/food/me');
  assert.equal(afterFood.status, 200);

  const otherTeam = await api(signToken(FIXTURES.participant), 'GET', '/food/me');
  assert.equal(otherTeam.status, 403);
  assert.equal(otherTeam.data.error.code, 'TEAM_NOT_VERIFIED');

  // T01's own registration state was untouched.
  const { rows } = await pool.query('SELECT registration_status FROM teams WHERE team_id = $1', ['T01']);
  assert.equal(rows[0].registration_status, 'UNREGISTERED');
});

// ------------------------------------------------ broadcast completeness ----

test('qr: registration:completed carries REGISTERED + member_count to the team room', async () => {
  await api(null, 'POST', '/registration', regPayload());
  const token = await getTeamToken('T02');

  const member = await login('amit@p.test', TEAM_PASSWORD);
  const socket = await connectSocket(member.data.token);
  try {
    const evt = once(socket, 'registration:completed');
    const verified = await api(signToken(FIXTURES.admin), 'POST', '/registration/verify', { token });
    assert.equal(verified.status, 200);

    const payload = await evt;
    assert.equal(payload.team.team_id, 'T02');
    assert.equal(payload.team.registration_status, 'REGISTERED');
    assert.equal(payload.team.member_count, 3);
  } finally {
    socket.disconnect();
  }
});
