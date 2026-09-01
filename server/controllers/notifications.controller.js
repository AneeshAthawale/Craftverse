import { asyncHandler } from '../utils/asyncHandler.js';
import { validateBody, assertEnum } from '../middleware/validate.js';
import * as notificationService from '../services/notification.service.js';

const NOTIFICATION_TYPES = ['NORMAL', 'IMPORTANT', 'GAME', 'EMERGENCY'];

export const listNotifications = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const notifications = await notificationService.listNotifications(limit);
  res.json({ notifications });
});

export const createNotification = asyncHandler(async (req, res) => {
  const { type, title, message } = validateBody(req, ['title', 'message'], {
    type: 'string',
  });
  assertEnum('type', type, NOTIFICATION_TYPES);

  const notification = await notificationService.createNotification({
    type: type || 'NORMAL',
    title,
    message,
  });

  // Real-time broadcast to everyone (plan.md §13).
  const io = req.app.get('io');
  if (io) io.emit('notification:new', { notification });

  res.status(201).json({ notification });
});
