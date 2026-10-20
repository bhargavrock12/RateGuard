'use strict';

const crypto = require('crypto');
const env = require('../config/env');

const API_KEY_BYTES = 32;
const SCRYPT_KEYLEN = 64;

/** New tenant API key. Returned to the caller exactly once. */
function generateApiKey() {
  return `rg_${crypto.randomBytes(API_KEY_BYTES).toString('base64url')}`;
}

/** Deterministic, peppered, indexable. MUST match gateway/src/middleware/auth.js. */
function hashApiKey(raw) {
  return crypto.createHmac('sha256', env.API_KEY_PEPPER).update(raw).digest('hex');
}

/** Short, non-secret prefix kept for dashboards and support. */
function apiKeyPrefix(raw) {
  return raw.slice(0, 12);
}

/** scrypt$<saltHex>$<hashHex> */
function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(plain, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const derived = crypto.scryptSync(plain, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN);
    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length !== derived.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

module.exports = { generateApiKey, hashApiKey, apiKeyPrefix, hashPassword, verifyPassword };