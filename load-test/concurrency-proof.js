'use strict';

const { config } = require('./utils/config');
const log = require('./utils/logger');
const { proxyRequest, fireConcurrent } = require('./utils/http');
const admin = require('./utils/admin-client');
const { createChecker } = require('./utils/assert');
const { renderTable, nodeDistribution, saveReport } = require('./utils/report');

/**
 * Fresh tenant per run: limiter keys are rl:{tenantId}:... (F14), so a new tenant
 * is a clean keyspace. This is how the proof stays isolated without touching Redis.
 */
async function provision(runIndex) {
  const tenant = await admin.createTenant(`loadtest-proof-${Date.now()}-${runIndex}`);

  const policy = await admin.createPolicy({
    tenant_id: tenant.id,
    route_pattern: config.proofRoutePattern,
    algorithm: 'token_bucket',
    limit_count: config.capacity,
    // Zero refill: the expected result is a constant, not a function of burst duration.
    refill_rate: 0,
  });

  // High-limit policy on a separate route, used only to detect cache warmth
  // without spending tokens from the bucket under test.
  const warmupPolicy = await admin.createPolicy({
    tenant_id: tenant.id,
    route_pattern: config.warmupRoutePattern,
    algorithm: 'token_bucket',
    limit_count: 1_000_000,
    refill_rate: 1000,
  });

  return { tenant, policy, warmupPolicy };
}

async function runOnce(runIndex) {
  log.step(`Run ${runIndex + 1}/${config.runs} — ${config.requests} concurrent requests, capacity ${config.capacity}`);

  let fixture = null;
  try {
    fixture = await provision(runIndex);
    const apiKey = fixture.tenant.api_key;

    await admin.waitForPropagation({ apiKey });

    const startedAt = Date.now();
    const results = await fireConcurrent(config.requests, () =>
      proxyRequest({ apiKey, route: config.proofRoute })
    );
    const elapsedMs = Date.now() - startedAt;

    const allowed = results.filter((r) => r.status === 200);
    const denied = results.filter((r) => r.status === 429);
    const errored = results.filter((r) => r.status !== 200 && r.status !== 429);
    const nodes = new Set(results.map((r) => r.node).filter(Boolean));

    const checker = createChecker(`Concurrency proof — run ${runIndex + 1}`);

    // The claim itself.
    checker.equal('allowed requests', allowed.length, config.capacity);
    checker.equal('denied requests', denied.length, config.requests - config.capacity);
    checker.equal('errored requests', errored.length, 0);

    // Without this, a single-node run would produce identical output and prove nothing.
    checker.atLeast('distinct gateway replicas participated', nodes.size, 2);

    // Response-shape contract, not just the counts.
    checker.isTrue(
      'every allow carried X-RateLimit-Limit === capacity',
      allowed.every((r) => r.limit === config.capacity)
    );
    checker.isTrue(
      'every deny carried code LIMIT_EXCEEDED',
      denied.length > 0 && denied.every((r) => r.reasonCode === 'LIMIT_EXCEEDED')
    );
    checker.isTrue(
      'every deny carried a positive Retry-After',
      denied.length > 0 && denied.every((r) => Number.isFinite(r.retryAfter) && r.retryAfter >= 1)
    );
    checker.isTrue(
      'every response carried X-Request-Id',
      results.every((r) => r.status === 0 || Boolean(r.requestId))
    );

    checker.summary();

    const distribution = nodeDistribution(results);
    log.raw('');
    log.raw(
      renderTable(
        ['replica', 'allowed', 'denied', 'errored', 'total'],
        distribution.map((d) => [d.node, d.allowed, d.denied, d.errored, d.total])
      )
    );
    log.raw('');
    log.info('run_complete', {
      run: runIndex + 1,
      elapsedMs,
      allowed: allowed.length,
      denied: denied.length,
      nodes: [...nodes],
      passed: checker.passed,
    });

    return {
      passed: checker.passed,
      run: runIndex + 1,
      elapsedMs,
      allowed: allowed.length,
      denied: denied.length,
      errored: errored.length,
      nodes: [...nodes],
      distribution,
      checks: checker.results,
    };
  } finally {
    // Must run even on a crash, or CI accumulates orphan tenants.
    if (fixture) {
      try {
        await admin.deleteTenant(fixture.tenant.id); // cascades both policies
      } catch (err) {
        log.warn('teardown_failed', { error: err.message });
      }
    }
  }
}

async function main() {
  log.step('RateGuard — Distributed Rate Limiter Correctness Proof');
  log.info('target', {
    gateway: config.gatewayUrl,
    adminApi: config.adminApiUrl,
    capacity: config.capacity,
    requests: config.requests,
    runs: config.runs,
  });

  await admin.login();

  const runs = [];
  for (let i = 0; i < config.runs; i += 1) {
    runs.push(await runOnce(i));
  }

  const passed = runs.every((r) => r.passed);
  saveReport('concurrency-proof', { passed, runs });

  log.step(
    passed
      ? `RESULT: PASS — ${runs.length}/${runs.length} runs enforced exactly ${config.capacity} across replicas`
      : `RESULT: FAIL — ${runs.filter((r) => !r.passed).length}/${runs.length} runs did not hold the shared limit`
  );

  // Frozen F13: this exit code is the release gate.
  process.exitCode = passed ? 0 : 1;
}

main().catch((err) => {
  log.error('proof_crashed', { error: err.message, stack: err.stack });
  process.exitCode = 1;
});