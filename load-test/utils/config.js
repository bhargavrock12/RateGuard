'use strict';

function requireEnv(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        'See load-test/README.md "Environment variables".'
    );
  }
  return value;
}

const config = Object.freeze({
  // Nginx, NOT a single gateway. Pointing this at :3000 invalidates the proof.
  gatewayUrl: (process.env.GATEWAY_URL || 'http://localhost:8080').replace(/\/$/, ''),
  adminApiUrl: (process.env.ADMIN_API_URL || 'http://localhost:4001').replace(/\/$/, ''),

  adminUsername: requireEnv('ADMIN_USERNAME', 'admin'),
  adminPassword: requireEnv('ADMIN_PASSWORD', 'admin'),

  proofRoute: process.env.PROOF_ROUTE || '/loadtest/proof',
  proofRoutePattern: process.env.PROOF_ROUTE_PATTERN || '/loadtest/*',
  warmupRoute: process.env.WARMUP_ROUTE || '/loadtest-warmup/ping',
  warmupRoutePattern: process.env.WARMUP_ROUTE_PATTERN || '/loadtest-warmup/*',

  capacity: Number(process.env.PROOF_CAPACITY || 20),
  requests: Number(process.env.PROOF_REQUESTS || 100),
  runs: Number(process.env.PROOF_RUNS || 1),
  expectedNodes: Number(process.env.EXPECTED_NODES || 3),

  propagationTimeoutMs: Number(process.env.PROPAGATION_TIMEOUT_MS || 5000),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 10000),

  gatewayContainers: (process.env.GATEWAY_CONTAINERS || 'gateway-1,gateway-2,gateway-3')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  throughputConnections: (process.env.THROUGHPUT_CONNECTIONS || '10,50,100')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0),
  throughputDurationSec: Number(process.env.THROUGHPUT_DURATION_SEC || 10),
  throughputLimit: Number(process.env.THROUGHPUT_LIMIT || 10_000_000),

  reportsDir: process.env.REPORTS_DIR || 'reports',
  saveReports: process.env.SAVE_REPORTS !== 'false',
});

// A vacuous proof is worse than a failing one: it is green and meaningless.
if (config.capacity >= config.requests) {
  throw new Error(
    `PROOF_CAPACITY (${config.capacity}) must be < PROOF_REQUESTS (${config.requests}), ` +
      'otherwise no request is ever denied and the assertion passes vacuously.'
  );
}

module.exports = { config, requireEnv };