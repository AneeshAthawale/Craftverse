import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import { requireVerifiedTeam } from '../middleware/registration.js';
import * as rlglController from '../controllers/rlgl.controller.js';

const router = Router();

// Any authenticated user may read the authoritative RLGL state (used by the
// player page, the admin panel, and reconnect/refresh recovery).
router.get('/state', requireAuth, rlglController.getState);

// ADMIN/DEV control the light + round lifecycle.
router.post('/transition', requireAuth, requireRole('DEV', 'ADMIN'), rlglController.postTransition);
router.post('/disqualify/:teamId', requireAuth, requireRole('DEV', 'ADMIN'), rlglController.postDisqualifyTeam);
router.post('/disqualify-all', requireAuth, requireRole('DEV', 'ADMIN'), rlglController.postDisqualifyAll);
router.post('/reinstate/:teamId', requireAuth, requireRole('DEV', 'ADMIN'), rlglController.postReinstateTeam);
router.post('/start-round', requireAuth, requireRole('DEV', 'ADMIN'), rlglController.postStartRound);
router.post('/end-round', requireAuth, requireRole('DEV', 'ADMIN'), rlglController.postEndRound);

// Verified-team participants submit their own code (team identity from JWT).
router.post(
  '/submit',
  requireAuth,
  requireRole('PARTICIPANT'),
  requireVerifiedTeam,
  rlglController.postSubmit
);

// Verified-team participants report a RED-light typing violation (REST fallback
// for the socket rlgl:violation event; server validates the current light
// before disqualifying).
router.post(
  '/violation',
  requireAuth,
  requireRole('PARTICIPANT'),
  requireVerifiedTeam,
  rlglController.postViolation
);

export default router;
