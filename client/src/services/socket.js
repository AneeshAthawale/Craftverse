import { io } from 'socket.io-client';

let socket = null;

// Tiny listener registry so the UI can react to connect/disconnect.
const statusListeners = new Set();

function notifyStatus(connected) {
  statusListeners.forEach((fn) => fn(connected));
}

/** Connect to the backend socket with a JWT (required for auth). */
export function connectSocket(token) {
  if (socket && socket.connected) return socket;

  socket = io('/', {
    auth: { token },
    transports: ['websocket', 'polling'],
  });
  socket.on('connect', () => notifyStatus(true));
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
    notifyStatus(false);
  }
}

/** Subscribe to connection-status changes; returns an unsubscribe function. */
export function onSocketStatus(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
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
