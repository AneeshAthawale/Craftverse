import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setSubmitting(true);
    setError('');
    try {
      const user = await login(email.trim(), password);
      navigate(user.role === 'PARTICIPANT' || user.role === 'TEAM' ? '/' : '/admin', { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-title">
          CraftVerse
          <span className="login-subtitle">COMPETITION TERMINAL</span>
        </h1>
        <label className="login-label" htmlFor="login-email">Email</label>
        <input
          id="login-email"
          className="login-input"
          type="email"
          autoComplete="username"
          placeholder="you@craftverse.test"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="login-label" htmlFor="login-password">Password</label>
        <input
          id="login-password"
          className="login-input"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="login-error">{error}</p>}
        <button className="login-btn" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
