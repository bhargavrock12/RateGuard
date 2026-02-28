'use strict';

const crypto = require('crypto');
const { getTenantByKeyHash } = require('../config/policyCache');
const { AppError, ERROR_CODES } = require('../utils/errors');
const logger = require('../utils/logger');

const PEPPER = process.env.API_KEY_PEPPER || '';
if (!PEPPER) {
  logger.warn('api_key_pepper_missing', {
    detail: 'API_KEY_PEPPER is unset; set it before any non-local deployment',
  });
}

/** Deterministic hash so the lookup stays indexable. */
function hashApiKey(raw) {
  return crypto.createHmac('sha256', PEPPER).update(raw).digest('hex');
}

async function authenticate(req, _res, next) {
  try {
    const raw = req.get('x-api-key');
    if (!raw) {
      throw new AppError(ERROR_CODES.MISSING_API_KEY, 'X-API-Key header is required', 401);
    }

    const tenant = await getTenantByKeyHash(hashApiKey(raw));
    if (!tenant) {
      throw new AppError(ERROR_CODES.INVALID_API_KEY, 'Unknown API key', 401);
    }

    req.tenant = tenant; // { id, name, plan } — never the raw key
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { authenticate, hashApiKey };