'use strict';

const { randomUUID } = require('crypto');
const logger = require('./logger');

class AppError extends Error {
  constructor(code, message, status = 500, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.isOperational = true;
  }
}

const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

function newRequestId() {
  return randomUUID();
}

function buildErrorBody(code, message, requestId) {
  return { error: { code, message, requestId } };
}

function notFoundHandler(req, res) {
  res.status(404).json(buildErrorBody(ERROR_CODES.NOT_FOUND, 'Route not found', req.requestId));
}

/** Map known Prisma failures onto the shared envelope. */
function fromPrisma(err) {
  if (err.code === 'P2002') {
    const target = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : 'field';
    return new AppError(ERROR_CODES.CONFLICT, `Duplicate value for ${target}`, 409);
  }
  if (err.code === 'P2025') {
    return new AppError(ERROR_CODES.NOT_FOUND, 'Record not found', 404);
  }
  if (err.code === 'P2003') {
    return new AppError(ERROR_CODES.VALIDATION_ERROR, 'Referenced record does not exist', 400);
  }
  return null;
}

/* eslint-disable no-unused-vars */
function errorHandler(err, req, res, next) {
  const mapped = err instanceof AppError ? err : fromPrisma(err) || null;
  const operational = Boolean(mapped);
  const status = operational ? mapped.status : 500;
  const code = operational ? mapped.code : ERROR_CODES.INTERNAL_ERROR;
  const message = operational ? mapped.message : 'Internal server error';

  logger.error('request_failed', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    code,
    status,
    err: err.message,
    stack: operational ? undefined : err.stack,
  });

  if (res.headersSent) return;

  const body = buildErrorBody(code, message, req.requestId);
  if (operational && mapped.details) body.error.details = mapped.details;
  res.status(status).json(body);
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