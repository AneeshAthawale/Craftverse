/**
 * Boot-prune child used by rlgl.test.js to simulate a server restart while a
 * transition is pending. The child imports server.js, whose boot sequence runs
 * pruneRlglTimers() against the SAME database, then reports the outcome over
 * IPC. It never listens — the fork is short-lived.
 *
 * Only ever run from the RLGL test suite.
 */

import { config } from '../config/index.js';
import { bindRlglIo, pruneRlglTimers } from '../services/rlgl.service.js';
import { createApp } from '../app.js';

async function main() {
  try {
    const built = createApp();
    bindRlglIo(built.io);
    // Simulates the server.js boot sequence (prune/re-arm pending transitions).
    await pruneRlglTimers();
    process.send({ pruned: true, pruneOnBoot: config.rlglPruneOnBoot });
  } catch (err) {
    try {
      process.send({ pruned: false, error: err.message });
    } catch {
      // Parent already gone.
    }
  } finally {
    // Give the IPC message a tick to flush, then exit.
    setTimeout(() => process.exit(0), 50);
  }
}

main();
