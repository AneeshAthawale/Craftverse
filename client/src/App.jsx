import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import RLGL from './pages/RLGL';
import Admin from './pages/Admin';
import RLGLControlPanel from './pages/RLGLControlPanel';
import ScanRegistrationQR from './pages/ScanRegistrationQR';
import ScanFoodQR from './pages/ScanFoodQR';
import Login from './pages/Login';
import Register from './pages/Register';
import RequireAuth from './components/RequireAuth';
import { useAuth } from './context/useAuth.js';

/** UX-only guard: admin pages are for ADMIN/DEV. Backend enforces for real. */
function RequireAdmin({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'ADMIN' && user.role !== 'DEV') {
    return <Navigate to="/" replace />;
  }
  return children;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/games/rlgl"
          element={
            <RequireAuth>
              <RLGL />
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAuth>
              <RequireAdmin>
                <Admin />
              </RequireAdmin>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/games/rlgl"
          element={
            <RequireAuth>
              <RequireAdmin>
                <RLGLControlPanel />
              </RequireAdmin>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/scan/registration"
          element={
            <RequireAuth>
              <RequireAdmin>
                <ScanRegistrationQR />
              </RequireAdmin>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/scan/food"
          element={
            <RequireAuth>
              <RequireAdmin>
                <ScanFoodQR />
              </RequireAdmin>
            </RequireAuth>
          }
        />
      </Routes>
    </Router>
  );
}

export default App;
