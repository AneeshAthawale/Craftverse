import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import * as teamsController from '../controllers/teams.controller.js';

const router = Router();

// Team listing stays DEV/ADMIN (sensitive). Own-team fetch is allowed for
// TEAM and PARTICIPANT (ownership enforced in the controller).
router.get('/', requireAuth, requireRole('DEV', 'ADMIN'), teamsController.listTeams);

// QR access is for organizers + the team itself.
router.get('/:id/qr', requireAuth, requireRole('DEV', 'ADMIN', 'TEAM'), teamsController.getTeamQr);

// A team's own game results (ownership enforced in the controller).
router.get('/:id/results', requireAuth, requireRole('DEV', 'ADMIN', 'TEAM', 'PARTICIPANT'), teamsController.getTeamResults);

// Own team details: DEV/ADMIN any team, TEAM/PARTICIPANT only their own.
router.get('/:id', requireAuth, requireRole('DEV', 'ADMIN', 'TEAM', 'PARTICIPANT'), teamsController.getTeam);

export default router;
