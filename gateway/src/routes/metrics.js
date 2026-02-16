'use strict';

const express = require('express');
const client = require('prom-client');

const register = new client.Registry();
register.setDefaultLabels({ node: process.env.NODE_ID || 'gateway' });
client.collectDefaultMetrics({ register });

const requestsTotal = new client.Counter({
  name: 'rateguard_requests_total',
  help: 'Rate-limit decisions by tenant, route pattern and outcome',
  labelNames: ['tenant', 'route', 'decision', 'algorithm'],
  registers: [register],
});

const decisionLatency = new client.Histogram({
  name: 'rateguard_decision_duration_seconds',
  help: 'Time spent making the rate-limit decision (Redis round-trip included)',
  labelNames: ['algorithm'],
  buckets: [0.0005, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1],
  registers: [register],
});

const redisUnavailableTotal = new client.Counter({
  name: 'rateguard_redis_unavailable_total',
  help: 'Requests where the limiter could not reach Redis (fail-open/closed path)',
  labelNames: ['action'],
  registers: [register],
});

const anomalyThrottleTotal = new client.Counter({
  name: 'rateguard_anomaly_throttle_total',
  help: 'Requests served under an anomaly penalty multiplier',
  labelNames: ['tenant'],
  registers: [register],
});

const router = express.Router();

router.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

module.exports = {
  router,
  register,
  requestsTotal,
  decisionLatency,
  redisUnavailableTotal,
  anomalyThrottleTotal,
};