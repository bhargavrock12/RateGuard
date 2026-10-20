'use strict';

const express = require('express');
const env = require('../config/env');
const { signAdminToken } = require('../middleware/jwtAuth');
const { verifyPassword } = require('../utils/hash');
const { AppError, ERROR_CODES } = require('../utils/errors');
const { loginSchema, validate } = require('../validation/schemas');
const logger = require('../utils/logger');

const router = express.Router();

/** Coarse in-process login throttle — NOT a RateGuard policy (no Redis, no Lua). */
const attempts = new Map(); // ip -> { count, resetAt }

function sweep(now) {
  for (const [ip, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(ip);
  }
}

function registerAttempt(ip) {
  const now = Date.now();
  sweep(now);
  const entry = attempts.get(ip) || { count: 0, resetAt: now + env.LOGIN_WINDOW_MS };
  entry.count += 1;
  attempts.set(ip, entry);
  return entry;
}

function isThrottled(ip) {
  const entry = attempts.get(ip);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    attempts.delete(ip);
    return false;
  }
  return entry.count >= env.LOGIN_MAX_ATTEMPTS;
}

router.post('/login', validate(loginSchema), (req, _res, next) => {
  const ip = req.ip || 'unknown';

  if (isThrottled(ip)) {
    logger.warn('login_throttled', { requestId: req.requestId, ip });
    return next(
      new AppError(ERROR_CODES.TOO_MANY_ATTEMPTS, 'Too many login attempts, try again later', 429)
    );
  }

  const { username, password } = req.body;
  const userOk = username === env.ADMIN_USERNAME;
  const passOk = verifyPassword(password, env.ADMIN_PASSWORD_HASH);

  // Same response for both failure modes: no username oracle.
  if (!userOk || !passOk) {
    registerAttempt(ip);
    logger.warn('login_failed', { requestId: req.requestId, ip });
    return next(
      new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid username or password', 401)
    );
  }

  attempts.delete(ip);
  const token = signAdminToken(username);
  logger.info('login_succeeded', { requestId: req.requestId, subject: username });

  return _res.status(200).json({
    token_type: 'Bearer',
    token,
    expires_in: env.JWT_EXPIRES_IN,
  });
});

module.exports = { router };