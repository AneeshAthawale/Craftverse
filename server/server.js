import { createApp } from './app.js';
import { pingDb } from './config/db.js';
import { config } from './config/index.js';
import { bindRlglIo, pruneRlglTimers } from './services/rlgl.service.js';

const { app, server, io } = createApp();

// Authoritative RLGL broadcasts need the Socket.IO instance.
bindRlglIo(io);

async function start() {
  try {
    await pingDb();
    console.log(`[server] PostgreSQL connected (${config.databaseUrl.replace(/:\/\/.*@/, '://***@')})`);
  } catch (err) {
    console.error(`[server] FATAL: cannot connect to PostgreSQL — ${err.message}`);
    console.error('[server] Check DATABASE_URL in server/.env and that PostgreSQL is running.');
    process.exit(1);
  }

  // Heal any RLGL transition whose deadline passed while the server was down,
  // and re-arm any still-pending deadline. Skipped when RLGL_PRUNE_ON_BOOT=0
  // (integration tests build their own app + seed rows per test).
  if (config.rlglPruneOnBoot !== false) {
    pruneRlglTimers()
      .then(() => console.log('[rlgl] Transition timers pruned/re-armed on boot'))
      .catch((err) => console.error('[rlgl] Boot prune failed (RLGL state heals on next read):', err.message));
  }

  server.listen(config.port, () => {
    console.log(`[server] CraftVerse API listening on http://localhost:${config.port}`);
    console.log(`[server] Socket.IO ready on ws://localhost:${config.port}`);
  });
}

start();

export { app, server, io };
