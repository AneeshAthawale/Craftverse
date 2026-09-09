import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import * as inquiriesController from '../controllers/inquiries.controller.js';

const router = Router();

// Participants create inquiries and list their own; admins list and respond.
router.get('/mine', requireAuth, requireRole('PARTICIPANT'), inquiriesController.listMyInquiries);
router.get('/', requireAuth, requireRole('ADMIN', 'DEV'), inquiriesController.listInquiries);
router.post('/', requireAuth, requireRole('PARTICIPANT'), inquiriesController.createInquiry);
router.patch('/:id', requireAuth, requireRole('ADMIN', 'DEV'), inquiriesController.updateInquiry);

export default router;
