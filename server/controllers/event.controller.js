import { asyncHandler } from '../utils/asyncHandler.js';
import { validateBody, assertEnum } from '../middleware/validate.js';
import * as eventStatusService from '../services/eventStatus.service.js';
import { SOCKET_EVENTS } from '../sockets/index.js';

const EVENT_STATUSES = ['NOT_STARTED', 'LIVE', 'BREAK', 'ENDED'];

/** Any authenticated user may read the current event status. */
export const getStatus = asyncHandler(async (req, res) => {
  const row = await eventStatusService.getEventStatus();
  res.json({
    event: {
      status: row.status,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    },
  });
});

/** ADMIN/DEV only (enforced by requireRole on the route). */
export const updateStatus = asyncHandler(async (req, res) => {
  const { status } = validateBody(req, ['status'], { status: 'string' });
  assertEnum('status', status, EVENT_STATUSES);

  // Persist first — the broadcast below only fires after the DB update succeeds.
  const row = await eventStatusService.updateEventStatus(status, req.user.id);
  const event = { status: row.status, updatedAt: row.updated_at, updatedBy: row.updated_by };

  const io = req.app.get('io');
  if (io) io.emit(SOCKET_EVENTS.EVENT_STATUS, event);

  res.json({ event });
});
