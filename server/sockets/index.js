import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

/**
 * Socket.IO foundation (plan.md §20).
 *
 * - Auth: JWT via handshake.auth.token; unauthenticated sockets are rejected.
 * - Rooms:
 *     all                      every authenticated client
 *     role:<ROLE>              DEV / ADMIN / TEAM / PARTICIPANT
 *     team:<team_id>           team members + that team's TEAM user
 *     admin                    ADMIN + DEV
 * - Event names are the single source of truth for real-time updates.
 */
export const SOCKET_EVENTS = {
  EVENT_STATUS: 'event:status',
  GAME_STARTED: 'game:started',
  GAME_UPDATED: 'game:updated',
  GAME_ENDED: 'game:ended',
  NOTIFICATION_NEW: 'notification:new',
  INQUIRY_NEW: 'inquiry:new',
  INQUIRY_UPDATED: 'inquiry:updated',
  REGISTRATION_COMPLETED: 'registration:completed',
  FOOD_ACCESS_UPDATED: 'food:access:updated',
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

    socket.emit(SOCKET_EVENTS.EVENT_STATUS, {
      status: 'connected',
      role,
      team_id,
      connectedAt: new Date().toISOString(),
    });

    socket.on('disconnect', () => {
      // Rooms are cleaned up automatically by Socket.IO on disconnect.
    });
  });

  return io;
}
