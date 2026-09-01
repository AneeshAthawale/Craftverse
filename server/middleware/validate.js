import { ApiError } from '../utils/ApiError.js';

/**
 * Minimal body validation: ensures required fields are present (non-empty
 * strings/numbers) and returns a sanitized object of allowed fields.
 *
 * validateBody(req, ['email', 'password']) -> { email, password }
 * validateBody(req, ['token'], { token: 'string' })
 */
export function validateBody(req, requiredFields = [], types = {}) {
  const body = req.body ?? {};
  const out = {};

  for (const field of requiredFields) {
    const value = body[field];
    if (value === undefined || value === null || value === '') {
      throw ApiError.badRequest(`Missing required field: ${field}`, 'VALIDATION_ERROR');
    }
    out[field] = value;
  }

  for (const [field, type] of Object.entries(types)) {
    if (body[field] === undefined || body[field] === null) continue;
    const value = body[field];
    if (type === 'string' && typeof value !== 'string') {
      throw ApiError.badRequest(`Field ${field} must be a string`, 'VALIDATION_ERROR');
    }
    if (type === 'number' && typeof value !== 'number') {
      throw ApiError.badRequest(`Field ${field} must be a number`, 'VALIDATION_ERROR');
    }
    if (type === 'boolean' && typeof value !== 'boolean') {
      throw ApiError.badRequest(`Field ${field} must be a boolean`, 'VALIDATION_ERROR');
    }
    out[field] = value;
  }

  return out;
}

/** Enforce an allowed set of enum values on a field. */
export function assertEnum(field, value, allowed) {
  if (value !== undefined && !allowed.includes(value)) {
    throw ApiError.badRequest(`Field ${field} must be one of: ${allowed.join(', ')}`, 'VALIDATION_ERROR');
  }
}
