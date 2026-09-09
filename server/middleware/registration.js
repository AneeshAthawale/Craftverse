import { ApiError } from '../utils/ApiError.js';
import { assertTeamVerified } from '../services/registration.service.js';

/**
 * Event-day eligibility gate: PARTICIPANT users may only reach event
 * functionality (food tokens, game submission, violations) after their team
 * has been checked in (registration_status = REGISTERED, set by the admin's
 * Registration QR verification). Staff are unaffected.
 *
 * Must run after requireAuth; role filtering is done by requireRole at the
 * call site. The check is backend-authoritative — never trusts the client.
 */
export async function requireVerifiedTeam(req, res, next) {
  try {
    if (req.user?.role === 'PARTICIPANT') {
      if (!req.user.team_id) {
        throw ApiError.forbidden('Your account is not linked to a team', 'TEAM_NOT_VERIFIED');
      }
      await assertTeamVerified(req.user.team_id);
    }
    next();
  } catch (err) {
    next(err);
  }
}
