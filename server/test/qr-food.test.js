/**
 * Food QR — focused gap tests (Phase B of the QR system work).
 *
 * core-flows.test.js already covers UNUSED->USED, replay (ALREADY_USED),
 * expiry (TOKEN_EXPIRED), unknown token (INVALID_TOKEN), staff-only verify and
 * the staff 403 on /food/me. This file adds only the uncovered cases:
 *
 *  - each participant gets their OWN token; no cross-participant leakage
 *  - /food/verify ignores client-supplied ids (IDOR attempt)
 *  - verification broadcasts food:access:updated to the participant's team room
 *  - PARTICIPANT cannot enumerate /food/access
 *
 * The active-meal lookup is time-based, so this file pins the schedule (a meal
 * always active + the anchor set to today) to keep the assertions deterministic.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioc } from 'socket.io-client';
import {
  resetSchema,
  seedUsers,
  setTeamRegistered,
  signToken,
  FIXTURES,
  createApp,
  pool,
} from './helpers.js';
import { MEAL_TYPES, MEAL_WINDOWS } from '../utils/mealSchedule.js';

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

/** A second participant on the seeded team T01. */
const PARTICIPANT_2 = { user_id: 5, role: 'PARTICIPANT', team_id: 'T01', participant_id: 2 };

let savedWindows;

before(async () => {
  // Pin the schedule: every window open all day and the anchor set to today,
  // so getCurrentMeal() deterministically returns BREAKFAST on event day 1.
  savedWindows = { ...MEAL_WINDOWS };
  for (const meal of MEAL_TYPES) {
    MEAL_WINDOWS[meal] = ['00:00', '23:59'];
  }
  const d = new Date();
  process.env.EVENT_DAY_ONE = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const built = createApp();
  server = built.server;
  await new Promise((resolve) => server.listen(0, resolve));
  httpOrigin = `http://127.0.0.1:${server.address().port}`;
  baseUrl = `${httpOrigin}/api`;
});

after(async () => {
  Object.assign(MEAL_WINDOWS, savedWindows);
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

beforeEach(async () => {
  await resetSchema();
  await seedUsers();
  await pool.query(
    `INSERT INTO participants (participant_id, name, email, team_id)
     VALUES (2, 'Second Tester', 'p002@test.local', 'T01')`
  );
});

// ------------------------------------------------- per-participant scoping --

test('food: each participant gets their own token — never another participant\'s', async () => {
  await setTeamRegistered('T01');

  const first = await api(signToken(FIXTURES.participant), 'GET', '/food/me');
  const second = await api(signToken(PARTICIPANT_2), 'GET', '/food/me');

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  // The pinned schedule guarantees an active meal, so both must have a token.
  assert.ok(first.data.access, 'participant 1 should have a token');
  assert.ok(second.data.access, 'participant 2 should have a token');

  // Each token belongs to the caller's own participant only.
  assert.equal(Number(first.data.access.participant_id), 1);
  assert.equal(Number(second.data.access.participant_id), 2);
  assert.ok(first.data.access.token.startsWith('cv-food-001-'));
  assert.ok(second.data.access.token.startsWith('cv-food-002-'));
  assert.notEqual(first.data.access.token, second.data.access.token);

  // Cross-check against the DB: two distinct rows, one per participant.
  const { rows } = await pool.query(
    'SELECT participant_id, token FROM food_access ORDER BY participant_id'
  );
  assert.deepEqual(rows.map((r) => Number(r.participant_id)), [1, 2]);
});

// ------------------------------------------------------------ IDOR safety ---

test('food: verify ignores client-supplied ids and redeems the token\'s real record', async () => {
  await pool.query(
    `INSERT INTO food_access (participant_id, meal_type, event_day, token)
     VALUES (1, 'LUNCH', 1, 'cv-food-idor-token')`
  );

  // An attacker tries to redirect the redemption to another participant/team.
  const res = await api(signToken(FIXTURES.admin), 'POST', '/food/verify', {
    token: 'cv-food-idor-token',
    participant_id: 2,
    team_id: 'T99',
    food_access_id: 999,
    status: 'UNUSED',
  });

  assert.equal(res.status, 200);
  // The row that changed is the token's own — id 1, not the injected id 2.
  assert.equal(Number(res.data.access.participant_id), 1);
  assert.equal(res.data.access.status, 'USED');
  assert.equal(Number(res.data.participant.participant_id), 1);

  const { rows } = await pool.query('SELECT participant_id, status FROM food_access');
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].participant_id), 1);
  assert.equal(rows[0].status, 'USED');
});

// ------------------------------------------------------------- broadcast -----

test('food: verify broadcasts food:access:updated to the participant\'s team room', async () => {
  await pool.query(
    `INSERT INTO food_access (participant_id, meal_type, event_day, token)
     VALUES (1, 'LUNCH', 1, 'cv-food-broadcast')`
  );

  const socket = await connectSocket(signToken(FIXTURES.participant));
  try {
    const evt = once(socket, 'food:access:updated');
    const res = await api(signToken(FIXTURES.admin), 'POST', '/food/verify', {
      token: 'cv-food-broadcast',
    });
    assert.equal(res.status, 200);

    const payload = await evt;
    assert.equal(Number(payload.participantId), 1);
    assert.equal(payload.status, 'USED');
  } finally {
    socket.disconnect();
  }
});

// -------------------------------------------------------------- RBAC --------

test('food: a PARTICIPANT cannot enumerate all food access records', async () => {
  const res = await api(signToken(FIXTURES.participant), 'GET', '/food/access');
  assert.equal(res.status, 403);

  const staff = await api(signToken(FIXTURES.admin), 'GET', '/food/access');
  assert.equal(staff.status, 200);
  assert.ok(Array.isArray(staff.data.access));
});
