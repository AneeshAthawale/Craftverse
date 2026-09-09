import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import * as registrationController from '../controllers/registration.controller.js';

const router = Router();

// Public team registration (no auth). The response never exposes the QR token.
router.post('/', registrationController.registerPublic);

// Anyone authenticated can look up what a registration QR contains.
router.get('/qr/:token', requireAuth, registrationController.getByToken);

// Only organizers can perform verification.
router.post('/verify', requireAuth, requireRole('ADMIN', 'DEV'), registrationController.verify);

export default router;
