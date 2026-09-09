import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import * as gameResultsController from '../controllers/gameResults.controller.js';

const router = Router();

router.get('/:id/results', requireAuth, requireRole('DEV', 'ADMIN'), gameResultsController.getResults);
router.post('/:id/results', requireAuth, requireRole('DEV', 'ADMIN'), gameResultsController.upsertResult);
router.delete('/:id/results/:team_id', requireAuth, requireRole('DEV', 'ADMIN'), gameResultsController.deleteResult);

export default router;
