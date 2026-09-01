import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query, pingDb } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Public: server liveness.
router.get('/health', asyncHandler(async (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
}));

// Public: DB connectivity check (used by the dev dashboard / setup verification).
router.get('/health/db', asyncHandler(async (req, res) => {
  const ok = await pingDb();
  res.json({ status: ok ? 'ok' : 'error', database: ok ? 'connected' : 'unreachable' });
}));

// Authenticated: overall system status for DEV dashboard.
router.get('/status', requireAuth, asyncHandler(async (req, res) => {
  const dbOk = await pingDb();
  const { rows } = await query(
    'SELECT (SELECT COUNT(*) FROM users)::int AS users, (SELECT COUNT(*) FROM teams)::int AS teams'
  );
  res.json({
    status: dbOk ? 'ok' : 'degraded',
    database: dbOk ? 'connected' : 'unreachable',
    counts: rows[0],
    uptime: process.uptime(),
  });
}));

export default router;
