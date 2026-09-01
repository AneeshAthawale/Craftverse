import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { query } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';

const BCRYPT_ROUNDS = 10;

export async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/** Public user shape — never expose password_hash. */
export function publicUser(row) {
  return {
    id: row.user_id,
    email: row.email,
    role: row.role,
    team_id: row.team_id,
    participant_id: row.participant_id,
  };
}

function signToken(user) {
  return jwt.sign(
    {
      sub: String(user.user_id),
      role: user.role,
      team_id: user.team_id,
      participant_id: user.participant_id,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

export async function login(email, password) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user) {
    throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  return { token: signToken(user), user: publicUser(user) };
}

/** Load a user by id (from token) for GET /api/auth/me. */
export async function getUserById(userId) {
  const { rows } = await query(
    'SELECT user_id, email, role, team_id, participant_id FROM users WHERE user_id = $1',
    [userId]
  );
  if (!rows[0]) throw ApiError.notFound('User not found');
  return publicUser(rows[0]);
}
