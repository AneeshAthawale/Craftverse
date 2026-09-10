import { query, getClient } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { hashPassword } from './auth.service.js';

/**
 * Admin participant management (ADMIN/DEV only — enforced at the route level).
 *
 * Editing is deliberately scoped: name/email/phone only. Participant -> team
 * membership, is_leader semantics, registration/check-in state, food access and
 * game results are all managed by their own flows and are never touched here.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 72;

const SELECT_PARTICIPANT = `
  SELECT p.participant_id, p.name, p.email, p.phone, p.team_id, p.is_leader,
         p.created_at, p.updated_at, t.team_name, t.registration_status
  FROM participants p
  LEFT JOIN teams t ON t.team_id = p.team_id`;

function cleanName(name) {
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 100) {
    throw ApiError.badRequest('Name must be 1-100 characters', 'INVALID_NAME');
  }
  return name.trim();
}

function cleanEmail(email) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    throw ApiError.badRequest('A valid email address is required', 'INVALID_EMAIL');
  }
  return email.trim().toLowerCase();
}

function cleanPhone(phone) {
  if (phone === undefined || phone === null) return null;
  if (typeof phone !== 'string') {
    throw ApiError.badRequest('Phone must be a string', 'INVALID_PHONE');
  }
  const trimmed = phone.trim();
  if (trimmed.length > 30) {
    throw ApiError.badRequest('Phone must be at most 30 characters', 'INVALID_PHONE');
  }
  return trimmed || null;
}

function assertPassword(password) {
  if (
    typeof password !== 'string' ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    throw ApiError.badRequest(
      `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`,
      'INVALID_PASSWORD'
    );
  }
}

/** Map Postgres unique-violations to the project's friendly conflict codes. */
function uniqueEmailError(err) {
  if (err.code === '23505') {
    if (err.constraint === 'idx_participants_email' || err.constraint === 'users_email_key') {
      throw ApiError.conflict(
        'This email is already used by another participant or account',
        'DUPLICATE_EMAIL'
      );
    }
  }
  throw err;
}

/** ADMIN/DEV participant list — includes leader + team registration status. */
export async function listParticipants() {
  const { rows } = await query(
    `${SELECT_PARTICIPANT} ORDER BY p.participant_id`
  );
  return rows;
}

export async function getParticipantById(participantId) {
  const { rows } = await query(
    `${SELECT_PARTICIPANT} WHERE p.participant_id = $1`,
    [participantId]
  );
  if (!rows[0]) throw ApiError.notFound('Participant not found');
  return rows[0];
}

/**
 * Edit a participant's name/email/phone.
 *
 * Team membership, is_leader, registration state, food access and game results
 * are never modified. Email changes are atomic with the linked user account:
 * when the user's login email currently equals the participant's old email
 * (the public-registration model), it is updated to the new email too; when
 * they differ (legacy/dev seed accounts whose login email is separate), the
 * login identity is left untouched so dev credentials keep working.
 */
export async function updateParticipant(participantId, { name, email, phone }) {
  const newName = cleanName(name);
  const newEmail = cleanEmail(email);
  const newPhone = cleanPhone(phone);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT participant_id, email FROM participants WHERE participant_id = $1 FOR UPDATE`,
      [participantId]
    );
    const current = rows[0];
    if (!current) throw ApiError.notFound('Participant not found');

    await client.query(
      `UPDATE participants
       SET name = $2, email = $3, phone = $4, updated_at = now()
       WHERE participant_id = $1`,
      [participantId, newName, newEmail, newPhone]
    );

    const emailChanged = newEmail !== (current.email ?? '').toLowerCase();
    if (emailChanged) {
      // Only migrate the login account when it mirrors the participant email
      // (public-registration model). A separate login identity (dev seed) is
      // deliberately left alone.
      await client.query(
        `UPDATE users
         SET email = $3, updated_at = now()
         WHERE participant_id = $1 AND email = $2`,
        [participantId, current.email, newEmail]
      );
    }

    const { rows: updated } = await client.query(
      `${SELECT_PARTICIPANT} WHERE p.participant_id = $1`,
      [participantId]
    );

    await client.query('COMMIT');
    return updated[0];
  } catch (err) {
    await client.query('ROLLBACK');
    uniqueEmailError(err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Admin password reset. Validates length, hashes with the SAME mechanism as
 * registration/login (bcrypt via auth.service), and updates the linked user
 * account atomically. Never exposes or logs the password.
 */
export async function resetParticipantPassword(participantId, password) {
  assertPassword(password);

  const { rows } = await query(
    `SELECT user_id, email FROM users WHERE participant_id = $1`,
    [participantId]
  );
  if (!rows[0]) {
    throw ApiError.notFound('No login account is linked to this participant');
  }

  const passwordHash = await hashPassword(password);
  await query(
    `UPDATE users SET password_hash = $2, updated_at = now() WHERE user_id = $1`,
    [rows[0].user_id, passwordHash]
  );

  return { participant_id: participantId, email: rows[0].email };
}

/**
 * Make a participant the team leader (atomically).
 * The previous leader becomes is_leader=false, the new one true — exactly one
 * leader per team, enforced in a single transaction + the partial unique
 * index. Team membership, user accounts, registration state, food access and
 * game results are untouched, and Registration QR access stays team-wide.
 */
export async function setTeamLeader(participantId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT participant_id, team_id FROM participants
       WHERE participant_id = $1 FOR UPDATE`,
      [participantId]
    );
    const participant = rows[0];
    if (!participant) throw ApiError.notFound('Participant not found');

    await client.query(
      `UPDATE participants SET is_leader = false, updated_at = now()
       WHERE team_id = $1 AND is_leader = true`,
      [participant.team_id]
    );
    await client.query(
      `UPDATE participants SET is_leader = true, updated_at = now()
       WHERE participant_id = $1`,
      [participantId]
    );

    const { rows: updated } = await client.query(
      `${SELECT_PARTICIPANT} WHERE p.participant_id = $1`,
      [participantId]
    );

    await client.query('COMMIT');
    return { participant: updated[0], team_id: participant.team_id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
