import { asyncHandler } from '../utils/asyncHandler.js';
import { query } from '../config/db.js';

/** DEV/ADMIN dashboard overview counts (plan.md §10). */
export const getStats = asyncHandler(async (req, res) => {
  const [teams, participants, registeredTeams, games, foodUsed, openInquiries] = await Promise.all([
    query('SELECT COUNT(*)::int AS count FROM teams'),
    query('SELECT COUNT(*)::int AS count FROM participants'),
    query(`SELECT COUNT(*)::int AS count FROM teams WHERE registration_status = 'REGISTERED'`),
    query('SELECT COUNT(*)::int AS count FROM games'),
    query(`SELECT COUNT(*)::int AS count FROM food_access WHERE status = 'USED'`),
    query(`SELECT COUNT(*)::int AS count FROM inquiries WHERE status != 'RESOLVED'`),
  ]);

  res.json({
    stats: {
      teams: teams.rows[0].count,
      participants: participants.rows[0].count,
      registeredTeams: registeredTeams.rows[0].count,
      games: games.rows[0].count,
      foodUsed: foodUsed.rows[0].count,
      openInquiries: openInquiries.rows[0].count,
    },
  });
});
