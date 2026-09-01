import crypto from 'crypto';

/** Generate a secure random token string (URL-safe, no padding). */
export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Generate a hex token of the given byte length. */
export function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}
