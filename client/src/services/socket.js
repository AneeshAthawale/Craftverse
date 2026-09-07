import { io } from 'socket.io-client';

let socket = null;

// Tiny listener registries so the UI can react to connect/disconnect.
const statusListeners = new Set();
// Runs on every (re)connect — consumers refetch authoritative state here so a
// temporary connection loss never leaves stale UI (plan Phase 4 §11).
const reconnectListeners = new Set();
// Runs when the server rejects the socket handshake (expired/invalid JWT).
// Consumers force a session restore / logout so the socket never retries
// forever with a stale token.
const authErrorListeners = new Set();

function notifyStatus(connected) {
  statusListeners.forEach((fn) => fn(connected));
}

function notifyReconnect() {
  reconnectListeners.forEach((fn) => fn());
}

function notifyAuthError(reason) {
  authErrorListeners.forEach((fn) => fn(reason));
}

/**
 * Connect to the backend socket with a JWT (required for auth).
 *
 * The socket is a per-tab singleton, but the token belongs to THIS tab's
 * session (sessionStorage.cv_token). If a socket already exists — even one
 * still connecting or reconnecting — it is torn down first so the new token
 * is always the one presented in the handshake.
 *
 * A rejected handshake (INVALID_TOKEN / AUTH_REQUIRED) tears the socket down
 * and notifies auth-failure listeners instead of letting socket.io retry
 * forever with the stale credential.
 */
export function connectSocket(newToken) {
  if (socket) {
    // Always replace: a connected socket may carry a stale token, and a
    // disconnected one must not be resurrected with old auth.
    socket.removeAllListeners('connect');
    socket.removeAllListeners('disconnect');
    socket.removeAllListeners('connect_error');
    socket.disconnect();
    socket = null;
    notifyStatus(false);
  }

  socket = io('/', {
    auth: { token: newToken },
    transports: ['websocket', 'polling'],
  });
  socket.on('connect', () => {
    notifyStatus(true);
    notifyReconnect();
  });
  socket.on('disconnect', () => notifyStatus(false));
  socket.on('connect_error', (err) => {
    const reason = err?.message || 'connect_error';
    // Auth failures are terminal for this token — surface them so the app can
    // restore/log out instead of retrying with a dead credential forever.
    if (reason === 'INVALID_TOKEN' || reason === 'AUTH_REQUIRED') {
      notifyStatus(false);
      notifyAuthError(reason);
    }
  });
  return socket;
}

/** Disconnect and clear the singleton. */
export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners('connect');
    socket.removeAllListeners('disconnect');
    socket.removeAllListeners('connect_error');
    socket.disconnect();
    socket = null;
    notifyStatus(false);
  }
}

/** Subscribe to connection-status changes; returns an unsubscribe function. */
export function onSocketStatus(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/**
 * Subscribe to (re)connect events — fires after the socket connects, including
 * automatic reconnects. Returns an unsubscribe function.
 */
export function onReconnect(listener) {
  reconnectListeners.add(listener);
  return () => reconnectListeners.delete(listener);
}

/**
 * Subscribe to socket handshake auth failures (expired/invalid JWT). Returns
 * an unsubscribe function.
 */
export function onAuthError(listener) {
  authErrorListeners.add(listener);
  return () => authErrorListeners.delete(listener);
}

/** Subscribe to an event; returns an unsubscribe function. */
export function onEvent(event, handler) {
  if (!socket) {
    console.warn('[socket] onEvent called before connectSocket()');
    return () => {};
  }
  socket.on(event, handler);
  return () => socket.off(event, handler);
}

/** Access the raw socket (for advanced usage). */
export function getSocket() {
  return socket;
}
