import { useEffect, useState, useCallback } from 'react';
import { AuthContext } from './AuthContextValue.js';
import api from '../services/api.js';
import { connectSocket, disconnectSocket, onSocketStatus } from '../services/socket.js';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [socketConnected, setSocketConnected] = useState(false);

  // Restore session from stored token on first load.
  useEffect(() => {
    const token = api.getToken();
    if (!token) {
      // Defer so we don't setState synchronously in the effect body.
      queueMicrotask(() => setLoading(false));
      return;
    }
    let cancelled = false;
    api
      .get('/auth/me')
      .then(({ user }) => {
        if (cancelled) return;
        setUser(user);
        connectSocket(token);
      })
      .catch(() => {
        if (cancelled) return;
        api.clearToken();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Track socket connection state for the UI.
  useEffect(() => onSocketStatus(setSocketConnected), []);

  const login = useCallback(async (email, password) => {
    const { token, user } = await api.post('/auth/login', { email, password });
    api.setToken(token);
    setUser(user);
    connectSocket(token);
    return user;
  }, []);

  const logout = useCallback(() => {
    disconnectSocket();
    api.clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, socketConnected }}>
      {children}
    </AuthContext.Provider>
  );
}
