import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import * as teamsController from '../controllers/teams.controller.js';

const router = Router();

// Team listing stays DEV/ADMIN (sensitive). Own-team fetch is allowed for
// PARTICIPANT (ownership enforced in the controller).
router.get('/', requireAuth, requireRole('DEV', 'ADMIN'), teamsController.listTeams);

// Registration QR access: organizers, or the team leader participant of the
// team (leadership enforced in the controller).
router.get('/:id/qr', requireAuth, requireRole('DEV', 'ADMIN', 'PARTICIPANT'), teamsController.getTeamQr);

// A team's own game results (ownership enforced in the controller).
router.get('/:id/results', requireAuth, requireRole('DEV', 'ADMIN', 'PARTICIPANT'), teamsController.getTeamResults);

// Own team details: DEV/ADMIN any team, PARTICIPANT only their own.
router.get('/:id', requireAuth, requireRole('DEV', 'ADMIN', 'PARTICIPANT'), teamsController.getTeam);

export default router;
