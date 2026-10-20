'use strict';

const express = require('express');
const { checkDatabase } = require('../config/prisma');
const { isRedisHealthy } = require('../config/redis');

const router = express.Router();

/** Liveness: process is up. Deliberately touches no dependency. */
router.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'admin-api' });
});

/** Readiness: Postgres is hard-required, Redis is soft (publish is best-effort). */
router.get('/readyz', async (_req, res) => {
  const database = await checkDatabase();
  const redis = isRedisHealthy();

  if (!database) {
    return res.status(503).json({
      status: 'unavailable',
      service: 'admin-api',
      checks: { database, redis },
    });
  }

  return res.status(200).json({
    status: redis ? 'ok' : 'degraded',
    service: 'admin-api',
    checks: { database, redis },
  });
});

module.exports = { router };