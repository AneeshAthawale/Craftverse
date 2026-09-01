import express from 'express';
import cors from 'cors';
import http from 'http';
import { config } from './config/index.js';
import { pingDb } from './config/db.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { initSocket } from './sockets/index.js';

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

const port = config.port;

async function start() {
  try {
    await pingDb();
    console.log(`[server] PostgreSQL connected (${config.databaseUrl.replace(/:\/\/.*@/, '://***@')})`);
  } catch (err) {
    console.error(`[server] FATAL: cannot connect to PostgreSQL — ${err.message}`);
    console.error('[server] Check DATABASE_URL in server/.env and that PostgreSQL is running.');
    process.exit(1);
  }

  server.listen(port, () => {
    console.log(`[server] CraftVerse API listening on http://localhost:${port}`);
    console.log(`[server] Socket.IO ready on ws://localhost:${port}`);
  });
}

start();

export { app, server, io };
