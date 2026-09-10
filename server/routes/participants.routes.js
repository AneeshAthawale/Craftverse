import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import * as participantsController from '../controllers/participants.controller.js';

const router = Router();

// Whole router is ADMIN/DEV-only — PARTICIPANT gets 403 everywhere here.
router.use(requireAuth, requireRole('DEV', 'ADMIN'));

router.get('/', participantsController.listParticipants);
router.get('/:id', participantsController.getParticipant);
router.patch('/:id', participantsController.updateParticipant);
router.post('/:id/reset-password', participantsController.resetParticipantPassword);
router.post('/:id/make-leader', participantsController.makeTeamLeader);

export default router;
