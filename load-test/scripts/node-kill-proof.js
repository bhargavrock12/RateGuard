'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { config } = require('../utils/config');
const log = require('../utils/logger');
const { proxyRequest, fireConcurrent, sleep } = require('../utils/http');
const admin = require('../utils/admin-client');
const { createChecker } = require('../utils/assert');
const { renderTable, nodeDistribution, saveReport } = require('../utils/report');

const run = promisify(execFile);

async function dockerAvailable() {
  try {
    await run('docker', ['ps', '--format', '{{.Names}}']);
    return true;
  } catch {
    return false;
  }
}

async function stopContainer(name) {
  log.warn('killing_gateway_replica', { container: name });
  await run('docker', ['stop', name]);
}

async function startContainer(name) {
  log.info('restarting_gateway_replica', { container: name });
  await run('docker', ['start', name]);
}

async function main() {
  log.step('RateGuard — Statelessness Proof (node kill mid-burst)');

  if (!(await dockerAvailable())) {
    const message =
      'Docker CLI unavailable — this proof cannot run. ' +
      'Set ALLOW_DOCKER_SKIP=true to downgrade to a warning (never in CI).';
    if (process.env.ALLOW_DOCKER_SKIP === 'true') {
      log.warn('node_kill_skipped', { reason: message });
      return;
    }
    throw new Error(message);
  }

  const victim = config.gatewayContainers[config.gatewayContainers.length - 1];
  await admin.login();

  let tenant = null;
  let killed = false;

  try {
    tenant = await admin.createTenant(`loadtest-nodekill-${Date.now()}`);
    await admin.createPolicy({
      tenant_id: tenant.id,
      route_pattern: config.proofRoutePattern,
      algorithm: 'token_bucket',
      limit_count: config.capacity,
      refill_rate: 0,
    });
    await admin.createPolicy({
      tenant_id: tenant.id,
      route_pattern: config.warmupRoutePattern,
      algorithm: 'token_bucket',
      limit_count: 1_000_000,
      refill_rate: 1000,
    });

    const apiKey = tenant.api_key;
    await admin.waitForPropagation({ apiKey });

    // Sized so phase 1 cannot drain the bucket — otherwise phase 2 is denied
    // for a trivial reason and the kill never mattered.
    const phase1Count = Math.floor(config.capacity / 2);
    const phase2Count = config.requests - phase1Count;

    log.step(`Phase 1 — ${phase1Count} requests with all ${config.gatewayContainers.length} replicas up`);
    const phase1 = await fireConcurrent(phase1Count, () =>
      proxyRequest({ apiKey, route: config.proofRoute })
    );

    await stopContainer(victim);
    killed = true;
    await sleep(1000); // let nginx mark the upstream down

    log.step(`Phase 2 — ${phase2Count} requests with ${victim} stopped`);
    const phase2 = await fireConcurrent(phase2Count, () =>
      proxyRequest({ apiKey, route: config.proofRoute })
    );

    const all = [...phase1, ...phase2];
    const allowed = all.filter((r) => r.status === 200);
    const denied = all.filter((r) => r.status === 429);
    const errored = all.filter((r) => r.status !== 200 && r.status !== 429);
    const phase2Nodes = new Set(phase2.map((r) => r.node).filter(Boolean));

    const checker = createChecker('Statelessness proof — node killed mid-burst');

    // The whole claim: the shared limit is unchanged by losing a replica.
    checker.equal('total allowed across both phases', allowed.length, config.capacity);
    checker.atLeast('phase 1 allowed at least one request', phase1.filter((r) => r.status === 200).length, 1);
    checker.atLeast('phase 2 allowed the remaining capacity', phase2.filter((r) => r.status === 200).length, 1);
    checker.isTrue('killed replica served nothing in phase 2', !phase2Nodes.has(victim));
    checker.atLeast('surviving replicas served phase 2', phase2Nodes.size, 1);
    checker.isTrue(
      'every deny used the frozen envelope',
      denied.length > 0 && denied.every((r) => r.reasonCode === 'LIMIT_EXCEEDED')
    );

    checker.summary();

    const distribution = nodeDistribution(all);
    log.raw('');
    log.raw(
      renderTable(
        ['replica', 'allowed', 'denied', 'errored', 'total'],
        distribution.map((d) => [d.node, d.allowed, d.denied, d.errored, d.total])
      )
    );
    log.raw('');
    log.info('node_kill_summary', {
      victim,
      allowed: allowed.length,
      denied: denied.length,
      // Socket failures during the kill window are expected; they are neither allows nor denies.
      errored: errored.length,
      passed: checker.passed,
    });

    saveReport('node-kill-proof', {
      passed: checker.passed,
      victim,
      allowed: allowed.length,
      denied: denied.length,
      errored: errored.length,
      distribution,
      checks: checker.results,
    });

    log.step(
      checker.passed
        ? `RESULT: PASS — losing ${victim} did not change the enforced total`
        : `RESULT: FAIL — the shared limit changed when ${victim} was stopped`
    );
    process.exitCode = checker.passed ? 0 : 1;
  } finally {
    // Leaving the stack degraded would silently weaken every later proof run.
    if (killed) {
      try {
        await startContainer(victim);
        await sleep(2000);
      } catch (err) {
        log.error('replica_restart_failed', { container: victim, error: err.message });
      }
    }
    if (tenant) {
      try {
        await admin.deleteTenant(tenant.id);
      } catch (err) {
        log.warn('teardown_failed', { error: err.message });
      }
    }
  }
}

main().catch((err) => {
  log.error('node_kill_proof_crashed', { error: err.message, stack: err.stack });
  process.exitCode = 1;
});