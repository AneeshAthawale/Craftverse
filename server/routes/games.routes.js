import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import * as gamesController from '../controllers/games.controller.js';

const router = Router();

router.get('/', requireAuth, gamesController.listGames);
router.get('/:id', requireAuth, gamesController.getGame);
router.post('/', requireAuth, requireRole('DEV'), gamesController.createGame);
router.patch('/:id', requireAuth, requireRole('DEV', 'ADMIN'), gamesController.updateGame);

export default router;
