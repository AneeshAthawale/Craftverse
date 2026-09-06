import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import * as eventController from '../controllers/event.controller.js';

const router = Router();

// Any authenticated user can read the event status (participant dashboards).
router.get('/status', requireAuth, eventController.getStatus);

// Only organizers (ADMIN/DEV) can change the event lifecycle.
router.patch('/status', requireAuth, requireRole('ADMIN', 'DEV'), eventController.updateStatus);

export default router;
