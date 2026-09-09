import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { registerRlglSockets } from './rlgl.socket.js';
import { bindRlglIo } from '../services/rlgl.service.js';

/**
 * Socket.IO foundation (plan.md §20).
 *
 * - Auth: JWT via handshake.auth.token; unauthenticated sockets are rejected.
 * - Rooms:
 *     all                      every authenticated client
 *     role:<ROLE>              DEV / ADMIN / PARTICIPANT
 *     team:<team_id>           every member of a team (participants)
 *     admin                    ADMIN + DEV
 * - Event names are the single source of truth for real-time updates.
 */
export const SOCKET_EVENTS = {
  // Authoritative hackathon event lifecycle (broadcast by event.controller).
  EVENT_STATUS: 'event:status',
  GAME_STARTED: 'game:started',
  GAME_UPDATED: 'game:updated',
  GAME_ENDED: 'game:ended',
  NOTIFICATION_NEW: 'notification:new',
  INQUIRY_NEW: 'inquiry:new',
  INQUIRY_UPDATED: 'inquiry:updated',
  REGISTRATION_COMPLETED: 'registration:completed',
  FOOD_ACCESS_UPDATED: 'food:access:updated',
  // RLGL authoritative light state (server-driven countdown/transition).
  RLGL_STATE: 'rlgl:state',
  RLGL_RESULT: 'rlgl:result',
  // Per-connection handshake (informational; not the event lifecycle).
  SESSION_HELLO: 'session:hello',
};

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: config.clientOrigin,
      methods: ['GET', 'POST'],
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('AUTH_REQUIRED'));
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      socket.user = {
        id: payload.sub,
        role: payload.role,
        team_id: payload.team_id ?? null,
        participant_id: payload.participant_id ?? null,
      };
      return next();
    } catch (err) {
      return next(new Error('INVALID_TOKEN'));
    }
  });

  io.on('connection', (socket) => {
    const { role, team_id } = socket.user;

    socket.join('all');
    socket.join(`role:${role}`);
    if (team_id) socket.join(`team:${team_id}`);
    if (role === 'ADMIN' || role === 'DEV') socket.join('admin');

    socket.emit(SOCKET_EVENTS.SESSION_HELLO, {
      status: 'connected',
      role,
      team_id,
      connectedAt: new Date().toISOString(),
    });
  });

  // RLGL inbound admin control (rlgl:transition) + outbound broadcasts.
  // Rooms are cleaned up automatically by Socket.IO on disconnect.
  registerRlglSockets(io);
  // Authoritative RLGL broadcasts go through this same server instance
  // (works for both the real server boot and tests that build createApp()).
  bindRlglIo(io);

  return io;
}
