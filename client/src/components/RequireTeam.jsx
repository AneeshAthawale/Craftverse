import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';

/**
 * UX-only guard for /team. TEAM is the primary audience; ADMIN/DEV may also
 * open it for testing/operations. PARTICIPANT is redirected to the participant
 * dashboard. Backend authorization is the real enforcement.
 */
export default function RequireTeam({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'PARTICIPANT') {
    return <Navigate to="/" replace />;
  }
  return children;
}
