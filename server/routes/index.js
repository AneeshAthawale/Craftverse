import { Router } from 'express';
import authRoutes from './auth.routes.js';
import teamsRoutes from './teams.routes.js';
import participantsRoutes from './participants.routes.js';
import registrationRoutes from './registration.routes.js';
import foodRoutes from './food.routes.js';
import gamesRoutes from './games.routes.js';
import rlglRoutes from './rlgl.routes.js';
import gameResultsRoutes from './game-results.routes.js';
import notificationsRoutes from './notifications.routes.js';
import inquiriesRoutes from './inquiries.routes.js';
import adminRoutes from './admin.routes.js';
import eventRoutes from './event.routes.js';
import systemRoutes from './system.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/teams', teamsRoutes);
router.use('/participants', participantsRoutes);
router.use('/registration', registrationRoutes);
router.use('/food', foodRoutes);
// RLGL must be mounted before gamesRoutes' '/games/:id' so 'rlgl' is never
// parsed as a numeric game id.
router.use('/games/rlgl', rlglRoutes);
router.use('/games', gamesRoutes); // includes /games/:id/results
router.use('/games', gameResultsRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/inquiries', inquiriesRoutes);
router.use('/admin', adminRoutes);
router.use('/event', eventRoutes);
router.use('/', systemRoutes); // /health, /health/db, /status

export default router;
