'use strict';

const express = require('express');
const { isRedisHealthy } = require('../config/redis');
const { isCacheWarm } = require('../config/policyCache');

const router = express.Router();

router.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok', node: process.env.NODE_ID || 'gateway' });
});

router.get('/readyz', (_req, res) => {
  const redis = isRedisHealthy();
  const ready = redis;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    checks: { redis, cacheWarm: isCacheWarm() },
    node: process.env.NODE_ID || 'gateway',
  });
});

module.exports = { router };