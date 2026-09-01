import { asyncHandler } from '../utils/asyncHandler.js';
import { validateBody, assertEnum } from '../middleware/validate.js';
import { ApiError } from '../utils/ApiError.js';
import * as inquiryService from '../services/inquiry.service.js';

const INQUIRY_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];

/** Admin/DEV: list inquiries. */
export const listInquiries = asyncHandler(async (req, res) => {
  const { status } = req.query;
  assertEnum('status', status, INQUIRY_STATUSES);
  const inquiries = await inquiryService.listInquiries({ status });
  res.json({ inquiries });
});

/** PARTICIPANT/TEAM: list the caller's own inquiries only. */
export const listMyInquiries = asyncHandler(async (req, res) => {
  const inquiries = await inquiryService.listMyInquiries({
    participant_id: req.user.participant_id ?? null,
    team_id: req.user.team_id ?? null,
  });
  res.json({ inquiries });
});

/** Participant submits an inquiry from their dashboard. */
export const createInquiry = asyncHandler(async (req, res) => {
  const { title, message } = validateBody(req, ['title', 'message']);

  const inquiry = await inquiryService.createInquiry({
    participant_id: req.user.participant_id ?? null,
    team_id: req.user.team_id ?? null,
    title,
    message,
  });

  // Notify admins in real time (plan.md §14).
  const io = req.app.get('io');
  if (io) io.to('admin').emit('inquiry:new', { inquiry });

  res.status(201).json({ inquiry });
});

/** Admin/DEV: respond to / update an inquiry. */
export const updateInquiry = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw ApiError.badRequest('Invalid inquiry id');

  const { status, response } = validateBody(req, [], {
    status: 'string',
    response: 'string',
  });
  assertEnum('status', status, INQUIRY_STATUSES);

  const inquiry = await inquiryService.updateInquiry(id, { status, response });

  // Real-time update to the participant's team room.
  const io = req.app.get('io');
  if (io) {
    if (inquiry.team_id) {
      io.to(`team:${inquiry.team_id}`).emit('inquiry:updated', { inquiry });
    }
    io.to('admin').emit('inquiry:updated', { inquiry });
  }

  res.json({ inquiry });
});
