/**
 * Thin fetch wrapper around the CraftVerse backend.
 * All requests go through /api (proxied to the Express server in dev).
 *
 * Usage:
 *   import api from './api.js';
 *   const { user } = await api.post('/auth/login', { email, password });
 *   const { teams } = await api.get('/teams');
 *
 * Errors are thrown as { status, code, message } with a consistent shape,
 * mirroring the backend error format { error: { code, message } }.
 */

const BASE_URL = '/api';

async function request(method, path, body) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  const token = localStorage.getItem('cv_token');
  if (token) {
    options.headers.Authorization = `Bearer ${token}`;
  }

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, options);
  } catch {
    throw { status: 0, code: 'NETWORK_ERROR', message: 'Cannot reach the backend' };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON response (e.g. 500 HTML) — fall through to generic error.
  }

  if (!res.ok) {
    const error = data?.error || {};
    throw {
      status: res.status,
      code: error.code || 'ERROR',
      message: error.message || `Request failed with status ${res.status}`,
    };
  }

  return data;
}

const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
  // Token helpers for the future auth flow.
  setToken: (token) => localStorage.setItem('cv_token', token),
  clearToken: () => localStorage.removeItem('cv_token'),
  getToken: () => localStorage.getItem('cv_token'),
};

export default api;
