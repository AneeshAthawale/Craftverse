import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import { requireVerifiedTeam } from '../middleware/registration.js';
import * as foodController from '../controllers/food.controller.js';

const router = Router();

// Participant: their own current food token/QR — only once their team has been
// verified (checked in) on event day.
router.get(
  '/me',
  requireAuth,
  requireRole('PARTICIPANT'),
  requireVerifiedTeam,
  foodController.getMyFood
);

// Organizers: list all access + verify scans.
router.get('/access', requireAuth, requireRole('DEV', 'ADMIN'), foodController.listAccess);
router.post('/verify', requireAuth, requireRole('DEV', 'ADMIN'), foodController.verify);

export default router;
