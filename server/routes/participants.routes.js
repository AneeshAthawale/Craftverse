import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import * as participantsController from '../controllers/participants.controller.js';

const router = Router();

router.use(requireAuth, requireRole('DEV', 'ADMIN'));

router.get('/', participantsController.listParticipants);
router.get('/:id', participantsController.getParticipant);

export default router;
