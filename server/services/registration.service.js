import bcrypt from 'bcryptjs';
import { query, getClient } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { randomHex } from '../utils/token.js';

/** Maximum number of extra members beyond the team leader. */
export const MAX_MEMBERS = 3;
const MIN_PASSWORD_LENGTH = 6;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(message, code = 'VALIDATION_ERROR') {
  return ApiError.badRequest(message, code);
}

function cleanEmail(email) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    throw fail('A valid email address is required', 'INVALID_EMAIL');
  }
  return email.trim().toLowerCase();
}

function cleanName(name, label) {
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 100) {
    throw fail(`${label} must be 1-100 characters`, 'INVALID_NAME');
  }
  return name.trim();
}

/**
 * Validate + normalize a public registration payload. Every participant is
 * { name, email }; the leader is participant #1. Members rows that are
 * completely blank are dropped; partially filled rows are rejected.
 */
export function normalizeRegistrationBody(body) {
  const { teamName, leader, members = [], password } = body ?? {};

  if (typeof teamName !== 'string' || teamName.trim().length < 2 || teamName.trim().length > 100) {
    throw fail('Team name must be 2-100 characters', 'INVALID_TEAM_NAME');
  }
  if (!leader || typeof leader !== 'object') {
    throw fail('Team leader information is required');
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > 72) {
    throw fail(`Password must be ${MIN_PASSWORD_LENGTH}-72 characters`, 'INVALID_PASSWORD');
  }
  if (!Array.isArray(members) || members.length > MAX_MEMBERS) {
    throw fail(`A team may have at most ${MAX_MEMBERS} additional members`);
  }

  const people = [];
  const seenEmails = new Set();

  const addPerson = (name, email, isLeader) => {
    const clean = cleanName(name, isLeader ? 'Team leader name' : 'Participant name');
    const normalizedEmail = cleanEmail(email);
    if (seenEmails.has(normalizedEmail)) {
      throw fail('Each participant needs a unique email address', 'DUPLICATE_EMAIL');
    }
    seenEmails.add(normalizedEmail);
    people.push({ name: clean, email: normalizedEmail, is_leader: isLeader });
  };

  addPerson(leader.name, leader.email, true);

  for (const member of members) {
    if (!member || typeof member !== 'object') continue;
    const { name, email } = member;
    // Blank rows are allowed (optional member slots); partial rows are not.
    if ((!name || !String(name).trim()) && (!email || !String(email).trim())) continue;
    addPerson(name, email, false);
  }

  return {
    teamName: teamName.trim(),
    password,
    people,
    leaderEmail: people[0].email,
  };
}

/**
 * Public team registration (no auth). Atomically creates:
 * 1. teams row (auto 'T##' team_id + secure Registration QR token, SUBMITTED)
 * 2. registration row mirroring token + status
 * 3. every participant with the correct team_id (leader flagged is_leader)
 * 4. one PARTICIPANT login user per member (email = participant email,
 *    password = the shared team password)
 *
 * Any failure rolls the whole thing back — no partially registered teams, no
 * orphaned participants. Never returns the QR token to the public client.
 */
export async function registerTeam(body) {
  const { teamName, password, people, leaderEmail } = normalizeRegistrationBody(body);

  // Hash once outside the transaction (bcrypt is slow and needs no client).
  const passwordHash = await bcrypt.hash(password, 10);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: idRows } = await client.query(
      `SELECT 'T' || lpad(nextval('teams_team_id_seq')::text, 2, '0') AS team_id`
    );
    const teamId = idRows[0].team_id;
    const token = `cv-reg-${teamId}-${randomHex(8)}`;

    await client.query(
      `INSERT INTO teams (team_id, team_name, registration_token, registration_status)
       VALUES ($1, $2, $3, 'SUBMITTED')`,
      [teamId, teamName, token]
    );
    await client.query(
      `INSERT INTO registration (team_id, token, status)
       VALUES ($1, $2, 'SUBMITTED')`,
      [teamId, token]
    );

    for (const person of people) {
      const { rows: participantRows } = await client.query(
        `INSERT INTO participants (name, email, team_id, is_leader)
         VALUES ($1, $2, $3, $4)
         RETURNING participant_id`,
        [person.name, person.email, teamId, person.is_leader]
      );
      const participantId = participantRows[0].participant_id;

      // Role is always PARTICIPANT — the public endpoint can never mint
      // ADMIN/DEV/privileged accounts.
      await client.query(
        `INSERT INTO users (email, password_hash, role, participant_id, team_id)
         VALUES ($1, $2, 'PARTICIPANT', $3, $4)`,
        [person.email, passwordHash, participantId, teamId]
      );
    }

    await client.query('COMMIT');
    return {
      team_id: teamId,
      team_name: teamName,
      registration_status: 'SUBMITTED',
      leaderEmail,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      // Map known uniqueness violations to friendly duplicate errors. Unique
      // index violations report the index name; table constraints report the
      // constraint name.
      if (err.constraint === 'idx_teams_team_name') {
        throw ApiError.conflict('A team with this name has already registered', 'DUPLICATE_TEAM_NAME');
      }
      if (err.constraint === 'idx_participants_email' || err.constraint === 'users_email_key') {
        throw ApiError.conflict(
          'One of the participant emails is already registered to another team or account',
          'DUPLICATE_EMAIL'
        );
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Backend-authoritative eligibility check: a PARTICIPANT user's team must be
 * REGISTERED (checked in on event day via the Registration QR) before they may
 * reach event functionality (food tokens, game submission, violations).
 */
export async function assertTeamVerified(teamId) {
  const { rows } = await query(
    `SELECT registration_status FROM teams WHERE team_id = $1`,
    [teamId]
  );
  const team = rows[0];
  if (!team || team.registration_status !== 'REGISTERED') {
    throw ApiError.forbidden(
      'Your team has not been checked in yet — a team member must present the Registration QR at the venue',
      'TEAM_NOT_VERIFIED'
    );
  }
}

/**
 * Look up registration info by token. Returns only non-sensitive data:
 * team name + registration status (used to display the QR / status page).
 */
export async function getRegistrationByToken(token) {
  const { rows } = await query(
    `SELECT t.team_id, t.team_name, t.registration_status
     FROM teams t
     WHERE t.registration_token = $1`,
    [token]
  );
  if (!rows[0]) throw ApiError.notFound('Registration token not found', 'INVALID_TOKEN');
  return rows[0];
}

/**
 * Single-use registration verification (plan.md §8).
 * - Marks the team REGISTERED in both `teams` and `registration`.
 * - A second scan of the same token returns 409 ALREADY_REGISTERED.
 * - Never trusts a team_id supplied by the client.
 */
export async function verifyRegistration(token) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT team_id, registration_status FROM teams WHERE registration_token = $1 FOR UPDATE`,
      [token]
    );
    const team = rows[0];
    if (!team) {
      throw ApiError.notFound('Registration token not found', 'INVALID_TOKEN');
    }
    if (team.registration_status === 'REGISTERED') {
      throw ApiError.conflict(
        `Team ${team.team_id} is already registered`,
        'ALREADY_REGISTERED'
      );
    }

    const now = new Date();
    await client.query(
      `UPDATE teams SET registration_status = 'REGISTERED', registered_at = $2, updated_at = $2
       WHERE team_id = $1`,
      [team.team_id, now]
    );
    await client.query(
      `UPDATE registration SET status = 'REGISTERED', verified_at = $2, updated_at = $2
       WHERE team_id = $1`,
      [team.team_id, now]
    );

    const { rows: teamRow } = await client.query(
      `SELECT team_id, team_name, registration_status, registered_at
       FROM teams WHERE team_id = $1`,
      [team.team_id]
    );

    await client.query('COMMIT');
    return teamRow[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
