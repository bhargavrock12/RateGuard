'use strict';

const { randomUUID } = require('crypto');
const logger = require('./logger');

/** Operational error with a stable machine-readable code. */
class AppError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.isOperational = true;
  }
}

const ERROR_CODES = {
  MISSING_API_KEY: 'MISSING_API_KEY',
  INVALID_API_KEY: 'INVALID_API_KEY',
  NO_POLICY: 'NO_POLICY',
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  ANOMALY_THROTTLE: 'ANOMALY_THROTTLE',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

function newRequestId() {
  return randomUUID();
}

function buildErrorBody(code, message, requestId) {
  return { error: { code, message, requestId } };
}

function notFoundHandler(req, res) {
  res
    .status(404)
    .json(buildErrorBody(ERROR_CODES.NOT_FOUND, 'Route not found', req.requestId));
}

/* eslint-disable no-unused-vars */
function errorHandler(err, req, res, next) {
  const operational = err instanceof AppError;
  const status = operational ? err.status : 500;
  const code = operational ? err.code : ERROR_CODES.INTERNAL_ERROR;
  const message = operational ? err.message : 'Internal server error';

  logger.error('request_failed', {
    requestId: req.requestId,
    code,
    status,
    err: err.message,
    stack: operational ? undefined : err.stack,
  });

  if (res.headersSent) return;
  res.status(status).json(buildErrorBody(code, message, req.requestId));
}
/* eslint-enable no-unused-vars */

module.exports = {
  AppError,
  ERROR_CODES,
  newRequestId,
  buildErrorBody,
  notFoundHandler,
  errorHandler,
};