import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { ApiError } from '../utils/ApiError.js';

/** Verify the Bearer token and attach req.user = { id, role, team_id, participant_id }. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = {
      id: payload.sub,
      role: payload.role,
      team_id: payload.team_id ?? null,
      participant_id: payload.participant_id ?? null,
    };
    return next();
  } catch (err) {
    return next(ApiError.unauthorized('Invalid or expired token', 'INVALID_TOKEN'));
  }
}
