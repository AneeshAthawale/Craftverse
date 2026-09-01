import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import * as adminController from '../controllers/admin.controller.js';

const router = Router();

router.use(requireAuth, requireRole('DEV', 'ADMIN'));
router.get('/stats', adminController.getStats);

export default router;
