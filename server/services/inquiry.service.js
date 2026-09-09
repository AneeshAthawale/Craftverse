import { query } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';

const SELECT_INQUIRY = `
  SELECT i.inquiry_id, i.participant_id, i.team_id, i.title, i.message, i.status,
         i.response, i.created_at, i.updated_at, i.resolved_at,
         p.name AS participant_name, t.team_name
  FROM inquiries i
  LEFT JOIN participants p ON p.participant_id = i.participant_id
  LEFT JOIN teams t ON t.team_id = i.team_id`;

export async function listInquiries({ status } = {}) {
  const params = [];
  let where = '';
  if (status) {
    params.push(status);
    where = `WHERE i.status = $1`;
  }
  const { rows } = await query(
    `${SELECT_INQUIRY} ${where} ORDER BY i.created_at DESC`,
    params
  );
  return rows;
}

/**
 * A participant's own inquiries (matched by participant_id; team_id scoping
 * keeps member inquiries grouped per team).
 * PARTICIPANT users are identified by participant_id.
 */
export async function listMyInquiries({ participant_id, team_id }) {
  const clauses = [];
  const params = [];
  if (participant_id) {
    params.push(participant_id);
    clauses.push(`i.participant_id = $${params.length}`);
  } else if (team_id) {
    params.push(team_id);
    clauses.push(`i.team_id = $${params.length}`);
  }
  if (clauses.length === 0) return [];
  const { rows } = await query(
    `${SELECT_INQUIRY} WHERE ${clauses.join(' OR ')} ORDER BY i.created_at DESC`,
    params
  );
  return rows;
}

export async function getInquiryById(inquiryId) {
  const { rows } = await query(`${SELECT_INQUIRY} WHERE i.inquiry_id = $1`, [inquiryId]);
  if (!rows[0]) throw ApiError.notFound('Inquiry not found');
  return rows[0];
}

export async function createInquiry({ participant_id, team_id, title, message }) {
  const { rows } = await query(
    `INSERT INTO inquiries (participant_id, team_id, title, message)
     VALUES ($1, $2, $3, $4)
     RETURNING inquiry_id, participant_id, team_id, title, message, status,
               response, created_at, updated_at, resolved_at`,
    [participant_id ?? null, team_id ?? null, title, message]
  );
  return rows[0];
}

/**
 * Admin updates an inquiry: status and/or response.
 * Setting status to RESOLVED stamps resolved_at.
 */
export async function updateInquiry(inquiryId, { status, response } = {}) {
  const current = await getInquiryById(inquiryId);

  const cols = [];
  const params = [];
  if (status !== undefined) {
    params.push(status);
    cols.push(`status = $${params.length}`);
  }
  if (response !== undefined) {
    params.push(response);
    cols.push(`response = $${params.length}`);
  }
  if (status === 'RESOLVED' && current.status !== 'RESOLVED') {
    cols.push(`resolved_at = now()`);
  }
  if (status && status !== 'RESOLVED') {
    cols.push(`resolved_at = NULL`);
  }
  params.push(inquiryId);
  const { rows } = await query(
    `UPDATE inquiries SET ${cols.join(', ')}, updated_at = now()
     WHERE inquiry_id = $${params.length}
     RETURNING inquiry_id, participant_id, team_id, title, message, status,
               response, created_at, updated_at, resolved_at`,
    params
  );
  return rows[0];
}
