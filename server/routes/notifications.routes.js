import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import * as notificationsController from '../controllers/notifications.controller.js';

const router = Router();

router.get('/', requireAuth, notificationsController.listNotifications);
router.post('/', requireAuth, requireRole('ADMIN', 'DEV'), notificationsController.createNotification);

export default router;
