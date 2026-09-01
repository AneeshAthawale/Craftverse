import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';

/** Protects routes: redirects to /login when there is no authenticated user. */
export default function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="login-page"><p className="login-error">Loading…</p></div>;
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}
