/**
 * RLGL socket handlers — inbound admin control + authoritative broadcasts.
 *
 * Inbound (client → server):
 *   'rlgl:transition' { to: 'GREEN'|'RED' }   — ADMIN/DEV only (role from JWT)
 *   'rlgl:violation'  {}                       — TEAM/PARTICIPANT only (team
 *                                                from JWT); server validates the
 *                                                current light is RED and
 *                                                disqualifies the team
 *
 * Outbound (server → clients):
 *   'rlgl:state'   { gameId, state }           — broadcast to everyone (all room)
 *   'rlgl:result'  { type, gameId, result }    — team room only (per team)
 *
 * The admin socket handler schedules the transition through the service; the
 * current light never changes until the persisted deadline passes. Repeated
 * clicks while a transition is pending are acknowledged as no-ops so the admin
 * UI can disable its button.
 */
import { scheduleTransition, reportRedLightViolation } from '../services/rlgl.service.js';
import { SOCKET_EVENTS } from './index.js';

/**
 * Register inbound RLGL socket handlers. `io` is the Socket.IO server; this is
 * called from initSocket after the connection handler is set up.
 */
export function registerRlglSockets(io) {
  io.on('connection', (socket) => {
    // Admin control: light transitions (role enforced from the verified JWT).
    socket.on('rlgl:transition', async (payload, ack) => {
      const respond = typeof ack === 'function' ? ack : () => {};
      try {
        if (!socket.user || !['ADMIN', 'DEV'].includes(socket.user.role)) {
          respond({ ok: false, reason: 'FORBIDDEN' });
          return;
        }
        const to = payload?.to;
        if (to !== 'GREEN' && to !== 'RED') {
          respond({ ok: false, reason: 'VALIDATION_ERROR' });
          return;
        }

        const outcome = await scheduleTransition(to);
        if (outcome.scheduled) {
          io.emit(SOCKET_EVENTS.RLGL_STATE, {
            gameId: outcome.state.gameId,
            state: outcome.state,
          });
        }
        respond({ ok: outcome.scheduled, reason: outcome.reason ?? null, state: outcome.state });
      } catch (err) {
        respond({ ok: false, reason: err.code || 'ERROR', message: err.message });
      }
    });

    // Player violation: typing while the authoritative light is RED. The team
    // comes from the verified JWT; the service validates the current light and
    // disqualifies the team. The disqualification is broadcast to the team room
    // (rlgl:result + game:updated) so the player page and admin roster update.
    socket.on('rlgl:violation', async (payload, ack) => {
      const respond = typeof ack === 'function' ? ack : () => {};
      try {
        if (!socket.user || !['TEAM', 'PARTICIPANT'].includes(socket.user.role)) {
          respond({ ok: false, reason: 'FORBIDDEN' });
          return;
        }
        if (!socket.user.team_id) {
          respond({ ok: false, reason: 'NO_TEAM' });
          return;
        }
        const outcome = await reportRedLightViolation(socket.user.team_id);
        respond({ ok: outcome.ok, reason: outcome.reason ?? null, result: outcome.result ?? null });
      } catch (err) {
        respond({ ok: false, reason: err.code || 'ERROR', message: err.message });
      }
    });
  });
}
