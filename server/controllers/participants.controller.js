import { asyncHandler } from '../utils/asyncHandler.js';
import { query } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';

export const listParticipants = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT p.participant_id, p.name, p.email, p.phone, p.team_id, p.created_at,
            t.team_name
     FROM participants p
     LEFT JOIN teams t ON t.team_id = p.team_id
     ORDER BY p.participant_id`
  );
  res.json({ participants: rows });
});

export const getParticipant = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw ApiError.badRequest('Invalid participant id');

  const { rows } = await query(
    `SELECT p.participant_id, p.name, p.email, p.phone, p.team_id, p.created_at,
            t.team_name
     FROM participants p
     LEFT JOIN teams t ON t.team_id = p.team_id
     WHERE p.participant_id = $1`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound('Participant not found');
  res.json({ participant: rows[0] });
});
