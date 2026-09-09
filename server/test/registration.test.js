/**
 * Public team registration + event-day check-in integration tests.
 *
 * Covers:
 *  - Public POST /api/registration (no auth): creates the team row
 *    (SUBMITTED, auto team_id, QR token), the mirrored registration row,
 *    participants with the correct team_id + exactly one leader, and one
 *    PARTICIPANT login user per member (real login works). Response never
 *    contains the QR token and never claims an email was sent.
 *  - Validation 400s (team name, leader, member count, emails, password)
 *  - Duplicate team name -> 409 DUPLICATE_TEAM_NAME
 *  - Duplicate participant email (same or other team) -> 409 DUPLICATE_EMAIL
 *  - Transaction rollback: no partial teams/participants/users on failure
 *  - No privileged roles: the public endpoint only ever creates PARTICIPANT
 *  - TEAM role no longer exists (DB CHECK rejects it)
 *  - Check-in gating: unverified (SUBMITTED) teams are blocked from /food/me,
 *    RLGL submit and the rlgl:violation socket; after ADMIN verifies the
 *    Registration QR every participant of the team unlocks (backend-enforced)
 *  - Registration QR verify: single-use, staff-only, registration:completed
 *    broadcast to the team room
 *  - Registration QR is leader-only for PARTICIPANT users
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

function regPayload(overrides = {}) {
  return {
    teamName: 'Null Pointers Two',
    leader: { name: 'Rahul Kumar', email: 'rahul@p.test' },
    members: [
      { name: 'Amit Singh', email: 'amit@p.test' },
      { name: 'Neha Gupta', email: 'neha@p.test' },
    ],
    password: TEAM_PASSWORD,
    ...overrides,
  };
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = ioc(httpOrigin, {
      transports: ['websocket'],
      auth: { token },
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

/** Registration QR token stored for a team (mirrored in both tables). */
async function getTeamToken(teamId) {
  const { rows } = await pool.query(
    'SELECT registration_token FROM teams WHERE team_id = $1',
    [teamId]
  );
  return rows[0].registration_token;
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

// ---------------------------------------------------- public registration ----

test('registration: unauthenticated submit creates team (SUBMITTED) + participants + accounts', async () => {
  const { status, data } = await api(null, 'POST', '/registration', regPayload());
  assert.equal(status, 201, `register failed: ${JSON.stringify(data)}`);
  assert.equal(data.team.registration_status, 'SUBMITTED');
  assert.equal(data.team.team_id, 'T02'); // first auto-assigned id after T01
  assert.equal(data.team.registration_token, undefined, 'QR token must never be echoed');
  assert.equal(data.message.includes('Registration QR'), true);

  // Team row + mirrored registration row, both SUBMITTED, token identical.
  const teams = await pool.query('SELECT * FROM teams WHERE team_id = $1', ['T02']);
  assert.equal(teams.rows[0].registration_status, 'SUBMITTED');
  const regs = await pool.query('SELECT * FROM registration WHERE team_id = $1', ['T02']);
  assert.equal(regs.rows[0].status, 'SUBMITTED');
  assert.equal(regs.rows[0].token, teams.rows[0].registration_token);
  assert.ok(regs.rows[0].token.startsWith('cv-reg-T02-'));

  // Participants: leader + members, all on the same team_id, one leader.
  const parts = await pool.query(
    `SELECT participant_id, name, email, team_id, is_leader
     FROM participants WHERE email LIKE $1 ORDER BY participant_id`,
    ['%@p.test']
  );
  assert.equal(parts.rows.length, 3);
  for (const p of parts.rows) {
    assert.equal(p.team_id, 'T02');
  }
  const leaders = parts.rows.filter((p) => p.is_leader);
  assert.equal(leaders.length, 1);
  assert.equal(leaders[0].email, 'rahul@p.test');

  // One PARTICIPANT user per member, linked to participant + team.
  const users = await pool.query(
    `SELECT email, role, participant_id, team_id FROM users
     WHERE email LIKE $1 ORDER BY email`,
    ['%@p.test']
  );
  assert.equal(users.rows.length, 3);
  for (const u of users.rows) {
    assert.equal(u.role, 'PARTICIPANT');
    assert.equal(u.team_id, 'T02');
    assert.ok(u.participant_id);
  }

  // The leader's created account can log in with the submitted password.
  const loginRes = await login('rahul@p.test', TEAM_PASSWORD);
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.data.user.role, 'PARTICIPANT');
  assert.equal(loginRes.data.user.team_id, 'T02');
  assert.ok(loginRes.data.user.participant_id);
});

test('registration: duplicate team name -> 409 DUPLICATE_TEAM_NAME', async () => {
  const first = await api(null, 'POST', '/registration', regPayload());
  assert.equal(first.status, 201);
  const dup = await api(
    null,
    'POST',
    '/registration',
    regPayload({
      leader: { name: 'Other Leader', email: 'other@p.test' },
      members: [{ name: 'M', email: 'm@p.test' }],
    })
  );
  assert.equal(dup.status, 409);
  assert.equal(dup.data.error.code, 'DUPLICATE_TEAM_NAME');

  // Only the first team exists.
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM teams');
  assert.equal(rows[0].n, 2); // seeded T01 + first registration
});

test('registration: a participant email used by another team -> 409 DUPLICATE_EMAIL', async () => {
  const first = await api(null, 'POST', '/registration', regPayload());
  assert.equal(first.status, 201);

  const second = await api(
    null,
    'POST',
    '/registration',
    regPayload({
      teamName: 'Second Team',
      leader: { name: 'Boss', email: 'amit@p.test' }, // amit already registered
      members: [],
    })
  );
  assert.equal(second.status, 409);
  assert.equal(second.data.error.code, 'DUPLICATE_EMAIL');

  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM teams');
  assert.equal(rows[0].n, 2); // seeded T01 + first registration only
});

test('registration: validation rejects bad payloads with 400 and changes nothing', async () => {
  const cases = [
    ['empty team name', regPayload({ teamName: '  ' })],
    ['missing leader', (() => { const p = regPayload(); delete p.leader; return p; })()],
    ['missing password', (() => { const p = regPayload(); delete p.password; return p; })()],
    ['short password', regPayload({ password: '12345' })],
    ['bad leader email', regPayload({ leader: { name: 'X', email: 'not-an-email' } })],
    ['partial member row', regPayload({ members: [{ name: 'Only Name' }] })],
    ['four members', regPayload({ members: [
      { name: 'A', email: 'a@p.test' },
      { name: 'B', email: 'b@p.test' },
      { name: 'C', email: 'c@p.test' },
      { name: 'D', email: 'd@p.test' },
    ] })],
    ['duplicate email in form', regPayload({ members: [{ name: 'Clone', email: 'rahul@p.test' }] })],
  ];
  for (const [label, payload] of cases) {
    const { status } = await api(null, 'POST', '/registration', payload);
    assert.equal(status, 400, label);
  }

  // Nothing was created: just the seeded rows.
  const teams = await pool.query('SELECT COUNT(*)::int AS n FROM teams');
  const parts = await pool.query('SELECT COUNT(*)::int AS n FROM participants');
  const users = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  assert.equal(teams.rows[0].n, 1);
  assert.equal(parts.rows[0].n, 1);
  assert.equal(users.rows[0].n, 3);
});

test('registration: an email that already has an account rolls the whole transaction back', async () => {
  // The second member's email collides with the seeded admin user account —
  // this fails AFTER the team + leader participant were inserted.
  const payload = regPayload({
    members: [{ name: 'Impostor', email: FIXTURES.admin.email }],
  });
  const { status, data } = await api(null, 'POST', '/registration', payload);
  assert.equal(status, 409);
  assert.equal(data.error.code, 'DUPLICATE_EMAIL');

  // No partial registration: no new team, participants or users.
  const teams = await pool.query('SELECT COUNT(*)::int AS n FROM teams');
  const parts = await pool.query('SELECT COUNT(*)::int AS n FROM participants');
  const users = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  assert.equal(teams.rows[0].n, 1);
  assert.equal(parts.rows[0].n, 1);
  assert.equal(users.rows[0].n, 3);
});

test('registration: the public endpoint can never create privileged accounts', async () => {
  await api(null, 'POST', '/registration', regPayload());
  const { rows } = await pool.query(
    `SELECT DISTINCT role FROM users WHERE email LIKE $1`,
    ['%@p.test']
  );
  assert.deepEqual(rows.map((r) => r.role), ['PARTICIPANT']);
});

// -------------------------------------------------- check-in gating + unlock --

test('registration: SUBMITTED (not verified) teams are locked out of food/RLGL', async () => {
  const reg = await api(null, 'POST', '/registration', regPayload());
  assert.equal(reg.status, 201);
  const teamId = reg.data.team.team_id;

  const leaderLogin = await login('rahul@p.test', TEAM_PASSWORD);
  const memberLogin = await login('amit@p.test', TEAM_PASSWORD);
  assert.equal(leaderLogin.status, 200);
  assert.equal(memberLogin.status, 200);

  // Both the leader and every member are blocked until check-in.
  for (const token of [leaderLogin.data.token, memberLogin.data.token]) {
    const food = await api(token, 'GET', '/food/me');
    assert.equal(food.status, 403);
    assert.equal(food.data.error.code, 'TEAM_NOT_VERIFIED');

    const submit = await api(token, 'POST', '/games/rlgl/submit', { code: 'x' });
    assert.equal(submit.status, 403);
    assert.equal(submit.data.error.code, 'TEAM_NOT_VERIFIED');
  }

  // The socket violation path is gated the same way.
  const socket = await connectSocket(leaderLogin.data.token);
  try {
    const ack = await new Promise((resolve) => {
      socket.emit('rlgl:violation', {}, resolve);
    });
    assert.equal(ack.ok, false);
    assert.equal(ack.reason, 'TEAM_NOT_VERIFIED');
  } finally {
    socket.disconnect();
  }

  assert.ok(teamId);
});

test('registration: admin verify unlocks every member of the team (socket + backend)', async () => {
  await api(null, 'POST', '/registration', regPayload());
  const token = await getTeamToken('T02');

  const leaderLogin = await login('rahul@p.test', TEAM_PASSWORD);
  const memberLogin = await login('amit@p.test', TEAM_PASSWORD);
  assert.equal(leaderLogin.status, 200);
  assert.equal(memberLogin.status, 200);

  // Both members listen on the team room for the unlock broadcast.
  const [leaderSocket, memberSocket] = await Promise.all([
    connectSocket(leaderLogin.data.token),
    connectSocket(memberLogin.data.token),
  ]);
  try {
    const leaderEvt = once(leaderSocket, 'registration:completed');
    const memberEvt = once(memberSocket, 'registration:completed');

    const verified = await api(signToken(FIXTURES.admin), 'POST', '/registration/verify', {
      token,
    });
    assert.equal(verified.status, 200, `verify failed: ${JSON.stringify(verified.data)}`);
    assert.equal(verified.data.team.registration_status, 'REGISTERED');
    assert.ok(verified.data.team.registered_at);

    // Broadcast reached the whole team room (leader + member sockets).
    const [lEvt, mEvt] = await Promise.all([leaderEvt, memberEvt]);
    assert.equal(lEvt.team.team_id, 'T02');
    assert.equal(lEvt.team.registration_status, 'REGISTERED');
    assert.equal(mEvt.team.registration_status, 'REGISTERED');

    // Persisted in both tables.
    const teams = await pool.query('SELECT registration_status FROM teams WHERE team_id = $1', ['T02']);
    const regs = await pool.query('SELECT status, verified_at FROM registration WHERE team_id = $1', ['T02']);
    assert.equal(teams.rows[0].registration_status, 'REGISTERED');
    assert.equal(regs.rows[0].status, 'REGISTERED');
    assert.ok(regs.rows[0].verified_at);

    // No individual scans: every participant is now unlocked.
    for (const token of [leaderLogin.data.token, memberLogin.data.token]) {
      const food = await api(token, 'GET', '/food/me');
      assert.equal(food.status, 200);
    }
  } finally {
    leaderSocket.disconnect();
    memberSocket.disconnect();
  }
});

test('registration: verify is single-use and staff-only', async () => {
  await api(null, 'POST', '/registration', regPayload());
  const token = await getTeamToken('T02');

  // Anonymous -> 401.
  const anon = await api(null, 'POST', '/registration/verify', { token });
  assert.equal(anon.status, 401);

  // PARTICIPANT -> 403.
  const participant = await api(signToken(FIXTURES.participant), 'POST', '/registration/verify', { token });
  assert.equal(participant.status, 403);

  // Unknown token -> 404.
  const missing = await api(signToken(FIXTURES.admin), 'POST', '/registration/verify', { token: 'cv-reg-nope' });
  assert.equal(missing.status, 404);
  assert.equal(missing.data.error.code, 'INVALID_TOKEN');

  // First scan succeeds; a second scan of the same QR is rejected.
  const first = await api(signToken(FIXTURES.admin), 'POST', '/registration/verify', { token });
  assert.equal(first.status, 200);
  const again = await api(signToken(FIXTURES.admin), 'POST', '/registration/verify', { token });
  assert.equal(again.status, 409);
  assert.equal(again.data.error.code, 'ALREADY_REGISTERED');
});

// ------------------------------------------------------- Registration QR ----

test('registration: the team Registration QR is accessible to every team member (not just the leader)', async () => {
  const first = await api(null, 'POST', '/registration', regPayload());
  assert.equal(first.status, 201);
  const second = await api(
    null,
    'POST',
    '/registration',
    regPayload({
      teamName: 'Second Team',
      leader: { name: 'Boss', email: 'boss@p.test' },
      members: [],
    })
  );
  assert.equal(second.status, 201);
  const token = await getTeamToken('T02');

  const leaderLogin = await login('rahul@p.test', TEAM_PASSWORD);
  const memberLogin = await login('amit@p.test', TEAM_PASSWORD);
  const otherTeamLogin = await login('boss@p.test', TEAM_PASSWORD);

  // The leader can fetch the team QR and it matches the stored team token.
  const leaderQr = await api(leaderLogin.data.token, 'GET', '/teams/T02/qr');
  assert.equal(leaderQr.status, 200);
  assert.equal(leaderQr.data.team_id, 'T02');
  assert.equal(leaderQr.data.registration_status, 'SUBMITTED');
  assert.equal(leaderQr.data.token, token);

  // A NON-leader member of the same team can present the exact same QR.
  const memberQr = await api(memberLogin.data.token, 'GET', '/teams/T02/qr');
  assert.equal(memberQr.status, 200);
  assert.equal(memberQr.data.token, token);

  // A participant of a different team is denied (403) — QR stays team-scoped.
  const otherQr = await api(otherTeamLogin.data.token, 'GET', '/teams/T02/qr');
  assert.equal(otherQr.status, 403);

  // Staff may fetch it for operations.
  const adminQr = await api(signToken(FIXTURES.admin), 'GET', '/teams/T02/qr');
  assert.equal(adminQr.status, 200);
  assert.equal(adminQr.data.token, token);
});

// ------------------------------------------------------- RBAC / TEAM role ----

test('registration: the TEAM role no longer exists in the users role CHECK', async () => {
  await assert.rejects(
    pool.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('team@test.local', 'x', 'TEAM')`
    ),
    (err) => err.code === '23514'
  );
});
