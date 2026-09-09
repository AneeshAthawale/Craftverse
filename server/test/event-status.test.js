/**
 * Phase 4 — Event lifecycle integration tests.
 *
 * Covers (plan §13):
 *  - GET  /api/event/status (authenticated)
 *  - PATCH /api/event/status as ADMIN / DEV (200)
 *  - PATCH as PARTICIPANT (403)
 *  - PATCH with invalid status (400)
 *  - DB value actually updated
 *  - Socket.IO: ADMIN change broadcasts `event:status` to participant/admin
 *  - Socket.IO: no broadcast when the DB update fails
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
let httpOrigin; // e.g. http://127.0.0.1:PORT  (socket.io attaches at root, not /api)
let baseUrl;    // e.g. http://127.0.0.1:PORT/api

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

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

async function patchStatus(role, body) {
  const res = await fetch(`${baseUrl}/event/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...auth(signToken(FIXTURES[role])) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function getStatus(token) {
  const res = await fetch(`${baseUrl}/event/status`, {
    headers: auth(token),
  });
  return { status: res.status, data: await res.json() };
}

/** Open a socket client; resolves once connected. */
function connectSocket(role) {
  return new Promise((resolve, reject) => {
    const socket = ioc(httpOrigin, {
      transports: ['websocket'],
      auth: { token: signToken(FIXTURES[role]) },
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

// ---------------------------------------------------------------- API ----

test('GET /api/event/status returns the persisted status for any role', async () => {
  const adminToken = signToken(FIXTURES.admin);
  const res = await getStatus(adminToken);
  assert.equal(res.status, 200);
  assert.equal(res.data.event.status, 'NOT_STARTED'); // schema default

  // Different authenticated role reads the same value.
  const participantRes = await getStatus(signToken(FIXTURES.participant));
  assert.equal(participantRes.status, 200);
  assert.equal(participantRes.data.event.status, 'NOT_STARTED');
});

test('GET /api/event/status requires authentication', async () => {
  const res = await fetch(`${baseUrl}/event/status`);
  assert.equal(res.status, 401);
});

test('PATCH /api/event/status as ADMIN succeeds and persists to the DB', async () => {
  const { status, data } = await patchStatus('admin', { status: 'LIVE' });
  assert.equal(status, 200);
  assert.equal(data.event.status, 'LIVE');
  // pg returns BIGINT as a string.
  assert.equal(data.event.updatedBy, String(FIXTURES.admin.user_id));

  const { rows } = await pool.query('SELECT status, updated_by FROM event_status WHERE id = 1');
  assert.equal(rows[0].status, 'LIVE');
  assert.equal(rows[0].updated_by, String(FIXTURES.admin.user_id));
});

test('PATCH /api/event/status as DEV succeeds', async () => {
  const { status, data } = await patchStatus('dev', { status: 'BREAK' });
  assert.equal(status, 200);
  assert.equal(data.event.status, 'BREAK');
});

test('PATCH /api/event/status as PARTICIPANT returns 403', async () => {
  const { status } = await patchStatus('participant', { status: 'LIVE' });
  assert.equal(status, 403);
});

test('PATCH with an invalid status is rejected with 400', async () => {
  const { status, data } = await patchStatus('admin', { status: 'PARTY_TIME' });
  assert.equal(status, 400);
  assert.equal(data.error.code, 'VALIDATION_ERROR');

  // DB unchanged.
  const { rows } = await pool.query('SELECT status FROM event_status WHERE id = 1');
  assert.equal(rows[0].status, 'NOT_STARTED');
});

test('PATCH with a missing status is rejected with 400', async () => {
  const { status } = await patchStatus('admin', {});
  assert.equal(status, 400);
});

// ------------------------------------------------------------ Socket ----

test('ADMIN status change broadcasts event:status to participant and admin sockets', async () => {
  const [participantSocket, adminSocket] = await Promise.all([
    connectSocket('participant'),
    connectSocket('admin'),
  ]);

  try {
    const p = once(participantSocket, 'event:status');
    const a = once(adminSocket, 'event:status');

    const { status } = await patchStatus('admin', { status: 'LIVE' });
    assert.equal(status, 200);

    const [pEvt, aEvt] = await Promise.all([p, a]);
    assert.equal(pEvt.status, 'LIVE');
    assert.equal(aEvt.status, 'LIVE');
  } finally {
    [participantSocket, adminSocket].forEach((s) => s.disconnect());
  }
});

test('no event:status broadcast when the DB update fails', async () => {
  const [participantSocket] = await Promise.all([connectSocket('participant')]);

  try {
    // Make the service UPDATE fail: delete the singleton row so the UPDATE
    // affects 0 rows -> service throws ApiError.notFound -> 404.
    await pool.query('DELETE FROM event_status WHERE id = 1');

    let received = false;
    participantSocket.on('event:status', () => {
      received = true;
    });

    const { status } = await patchStatus('admin', { status: 'LIVE' });
    assert.equal(status, 404);
    // Small wait to let any (wrongful) broadcast arrive.
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(received, false);
  } finally {
    participantSocket.disconnect();
  }
});
