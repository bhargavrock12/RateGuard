'use strict';

const express = require('express');
const crypto = require('crypto');

const env = require('./config/env');
const logger = require('./utils/logger');
const { connectPrisma, disconnectPrisma } = require('./config/prisma');
const { closeRedis } = require('./config/redis');
const { jwtAuth } = require('./middleware/jwtAuth');
const { notFoundHandler, errorHandler } = require('./utils/errors');

const health = require('./routes/health');
const auth = require('./routes/auth');
const tenants = require('./routes/tenants');
const policies = require('./routes/policies');
const metrics = require('./routes/metrics');

const app = express();

// Needed for a meaningful req.ip behind Nginx (the login throttle keys on it).
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  req.requestId = req.get('X-Request-Id') || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

// Admin payloads are small; an unbounded parser is free DoS surface.
app.use(express.json({ limit: '100kb' }));

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info('request', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
    });
  });
  next();
});

// --- Unauthenticated surface -------------------------------------------------
app.use('/', health.router);
app.use('/v1/admin', auth.router);

// --- Auth boundary: everything mounted below this line requires a valid JWT ---
app.use('/v1/admin', jwtAuth);

app.use('/v1/admin/tenants', tenants.router);
app.use('/v1/admin/policies', policies.router);
app.use('/v1/admin/metrics', metrics.router);

app.use(notFoundHandler);
app.use(errorHandler); // must be last, must take 4 args

let server;

async function start() {
  await connectPrisma();
  server = app.listen(env.PORT, () => {
    logger.info('admin_api_started', { port: env.PORT, nodeEnv: env.NODE_ENV });
  });
}

async function shutdown(signal) {
  logger.info('shutdown_started', { signal });
  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve)); // stop accepting first
    }
    await closeRedis();
    await disconnectPrisma();
    logger.info('shutdown_complete', { signal });
    process.exit(0);
  } catch (err) {
    logger.error('shutdown_failed', { signal, error: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM')); // what Docker sends
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', { error: String(reason) });
});

start().catch((err) => {
  logger.error('startup_failed', { error: err.message });
  process.exit(1);
});

module.exports = { app };