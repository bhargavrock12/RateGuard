'use strict';

const autocannon = require('autocannon');

const { config } = require('./utils/config');
const log = require('./utils/logger');
const admin = require('./utils/admin-client');
const { renderTable, saveReport } = require('./utils/report');

async function provisionHighLimitTenant(label, limitCount, refillRate) {
  const tenant = await admin.createTenant(`loadtest-throughput-${label}-${Date.now()}`);
  await admin.createPolicy({
    tenant_id: tenant.id,
    route_pattern: config.proofRoutePattern,
    algorithm: 'token_bucket',
    limit_count: limitCount,
    refill_rate: refillRate,
  });
  await admin.createPolicy({
    tenant_id: tenant.id,
    route_pattern: config.warmupRoutePattern,
    algorithm: 'token_bucket',
    limit_count: 1_000_000,
    refill_rate: 1000,
  });
  await admin.waitForPropagation({ apiKey: tenant.api_key });
  return tenant;
}

function runScenario({ label, connections, apiKey, durationSec }) {
  return new Promise((resolve, reject) => {
    autocannon(
      {
        url: `${config.gatewayUrl}/v1/proxy${config.proofRoute}`,
        connections,
        duration: durationSec,
        headers: { 'X-API-Key': apiKey },
        method: 'GET',
      },
      (err, result) => {
        if (err) return reject(err);
        return resolve({
          label,
          connections,
          durationSec,
          rps: Number(result.requests.average.toFixed(1)),
          p50: result.latency.p50,
          p95: result.latency.p97_5, // autocannon reports p97.5, not p95
          p99: result.latency.p99,
          max: result.latency.max,
          total: result.requests.total,
          // A run that is silently mostly 429 is a broken benchmark.
          non2xx: result.non2xx,
          errors: result.errors,
        });
      }
    );
  });
}

async function main() {
  log.step('RateGuard — Throughput Benchmark');
  log.info('target', { gateway: config.gatewayUrl, connections: config.throughputConnections });

  await admin.login();

  const allowTenant = await provisionHighLimitTenant('allow', config.throughputLimit, 1_000_000);
  // Low limit: the deny path is cheaper (no upstream hop) and is measured separately.
  const denyTenant = await provisionHighLimitTenant('deny', 1, 0);

  const scenarios = [];

  try {
    log.step('Warmup (discarded) — letting JIT, pools and the policy cache settle');
    await runScenario({
      label: 'warmup',
      connections: 10,
      apiKey: allowTenant.api_key,
      durationSec: 3,
    });

    for (const connections of config.throughputConnections) {
      log.step(`Allow path — ${connections} connections for ${config.throughputDurationSec}s`);
      scenarios.push(
        await runScenario({
          label: `allow@${connections}`,
          connections,
          apiKey: allowTenant.api_key,
          durationSec: config.throughputDurationSec,
        })
      );
    }

    const denyConnections = config.throughputConnections[0];
    log.step(`Deny path — ${denyConnections} connections for ${config.throughputDurationSec}s`);
    scenarios.push(
      await runScenario({
        label: `deny@${denyConnections}`,
        connections: denyConnections,
        apiKey: denyTenant.api_key,
        durationSec: config.throughputDurationSec,
      })
    );

    log.raw('');
    log.raw(
      renderTable(
        ['scenario', 'conns', 'rps', 'p50 ms', 'p95 ms', 'p99 ms', 'max ms', 'total', 'non2xx', 'errors'],
        scenarios.map((s) => [
          s.label,
          s.connections,
          s.rps,
          s.p50,
          s.p95,
          s.p99,
          s.max,
          s.total,
          s.non2xx,
          s.errors,
        ])
      )
    );
    log.raw('');
    log.raw('  Note: allow-path rows include the upstream hop to backend-dummy.');
    log.raw('  Deny-path latency is lower because a denied request never reaches the upstream.');
    log.raw('  These are measured numbers on this hardware. Do not quote them as universal.');
    log.raw('');

    saveReport('throughput-test', { scenarios });
  } finally {
    for (const tenant of [allowTenant, denyTenant]) {
      try {
        await admin.deleteTenant(tenant.id);
      } catch (err) {
        log.warn('teardown_failed', { tenantId: tenant.id, error: err.message });
      }
    }
  }
}

main().catch((err) => {
  log.error('throughput_test_crashed', { error: err.message, stack: err.stack });
  process.exitCode = 1;
});