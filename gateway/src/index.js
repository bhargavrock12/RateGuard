'use strict';

const express = require('express');

const { initRedis, closeRedis } = require('./config/redis');
const { initPolicyCache, closePolicyCache } = require('./config/policyCache');
const { authenticate } = require('./middleware/auth');
const { rateLimit } = require('./middleware/rateLimiter');
const { forward } = require('./middleware/proxy');
const metrics = require('./routes/metrics');
const health = require('./routes/health');
const { newRequestId, notFoundHandler, errorHandler } = require('./utils/errors');
const logger = require('./utils/logger');

const PORT = Number(process.env.PORT || 3000);
const NODE_ID = process.env.NODE_ID || 'gateway';
const PROXY_PREFIX = '/v1/proxy';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

// Correlation id for logs and error bodies.
app.use((req, res, next) => {
  req.requestId = req.get('x-request-id') || newRequestId();
  res.set('X-Request-Id', req.requestId);
  res.set('X-Gateway-Node', NODE_ID);
  next();
});

app.use(health.router);
app.use(metrics.router);

// Hot path. Order is load-bearing: identify -> limit -> forward.
app.all(
  `${PROXY_PREFIX}/*`,
  (req, _res, next) => {
    const pathOnly = req.originalUrl.split('?')[0];
    req.upstreamPath = pathOnly.slice(PROXY_PREFIX.length) || '/';
    next();
  },
  authenticate,
  rateLimit,
  forward
);

app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  await initRedis();
  await initPolicyCache().catch((err) =>
    logger.error('policy_cache_init_failed', { err: err.message })
  );

  const server = app.listen(PORT, () => {
    logger.info('gateway_started', { port: PORT, node: NODE_ID, proxyPrefix: PROXY_PREFIX });
  });

  const shutdown = async (signal) => {
    logger.info('shutdown_started', { signal });
    server.close(async () => {
      await Promise.allSettled([closeRedis(), closePolicyCache()]);
      logger.info('shutdown_complete');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  start().catch((err) => {
    logger.error('startup_failed', { err: err.message, stack: err.stack });
    process.exit(1);
  });
}

module.exports = { app, start };