'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { AppError, ERROR_CODES } = require('../utils/errors');

function signAdminToken(subject) {
  return jwt.sign({ role: 'admin' }, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

function jwtAuth(req, _res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(
      new AppError(ERROR_CODES.UNAUTHORIZED, 'Bearer token required', 401)
    );
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'], // pinning the algorithm blocks alg=none
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
    req.admin = { subject: payload.sub, role: payload.role };
    return next();
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
    return next(new AppError(ERROR_CODES.UNAUTHORIZED, message, 401));
  }
}

module.exports = { jwtAuth, signAdminToken };