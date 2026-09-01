import { ApiError } from '../utils/ApiError.js';

/**
 * requireRole('ADMIN', 'DEV') — backend-enforced role guard.
 * Must run after requireAuth (uses req.user).
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized());
    }
    if (!roles.includes(req.user.role)) {
      return next(
        ApiError.forbidden(`Requires role: ${roles.join(' or ')}`)
      );
    }
    return next();
  };
}
