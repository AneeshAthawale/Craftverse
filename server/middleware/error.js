import { ApiError } from '../utils/ApiError.js';

/** Centralized error handler — consistent error responses. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message },
    });
  }

  // PostgreSQL unique-violation → 409
  if (err.code === '23505') {
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'A record with the same unique value already exists.' },
    });
  }

  // PostgreSQL foreign-key violation → 400
  if (err.code === '23503') {
    return res.status(400).json({
      error: { code: 'FOREIGN_KEY_VIOLATION', message: 'Referenced record does not exist.' },
    });
  }

  console.error('[error]', err);
  return res.status(500).json({
    error: { code: 'INTERNAL', message: 'Internal server error' },
  });
}

/** 404 for unknown /api routes. */
export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  });
}
