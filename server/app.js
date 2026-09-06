import express from 'express';
import cors from 'cors';
import http from 'http';
import { config } from './config/index.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { initSocket } from './sockets/index.js';

/**
 * Builds the Express app + Socket.IO server without listening.
 * server.js starts it; tests import it directly on an ephemeral port.
 */
export function createApp() {
  const app = express();
  const server = http.createServer(app);

  app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json());

  // API routes
  app.use('/api', routes);

  // 404 for unknown API routes + centralized error handling
  app.use('/api', notFoundHandler);
  app.use('/api', errorHandler);

  // Socket.IO (JWT-authed, room-based)
  const io = initSocket(server);
  app.set('io', io);

  return { app, server, io };
}
