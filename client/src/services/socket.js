import { io } from 'socket.io-client';

let socket = null;
let token = null;

// Tiny listener registries so the UI can react to connect/disconnect.
const statusListeners = new Set();
// Runs on every (re)connect — consumers refetch authoritative state here so a
// temporary connection loss never leaves stale UI (plan Phase 4 §11).
const reconnectListeners = new Set();

function notifyStatus(connected) {
  statusListeners.forEach((fn) => fn(connected));
}

function notifyReconnect() {
  reconnectListeners.forEach((fn) => fn());
}

/**
 * Connect to the backend socket with a JWT (required for auth).
 *
 * The socket is a per-tab singleton, but the token belongs to THIS tab's
 * session (sessionStorage.cv_token). If a socket already exists — even one
 * still connecting or reconnecting — it is torn down first so the new token
 * is always the one presented in the handshake. `token` is deliberately a
 * module variable captured at connect time (never re-read from storage), so a
 * logout/login in this tab or a different token in another tab can never leak
 * into this socket.
 */
export function connectSocket(newToken) {
  if (socket) {
    // Always replace: a connected socket may carry another tab's / a stale
    // token, and a disconnected one must not be resurrected with old auth.
    socket.removeAllListeners('connect');
    socket.removeAllListeners('disconnect');
    socket.disconnect();
    socket = null;
    notifyStatus(false);
  }

  token = newToken;
  socket = io('/', {
    auth: { token: newToken },
    transports: ['websocket', 'polling'],
  });
  socket.on('connect', () => {
    notifyStatus(true);
    notifyReconnect();
  });
  socket.on('disconnect', () => notifyStatus(false));
  return socket;
}

/** Disconnect and clear the singleton. */
export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners('connect');
    socket.removeAllListeners('disconnect');
    socket.disconnect();
    socket = null;
    token = null;
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
