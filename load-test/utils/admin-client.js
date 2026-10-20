'use strict';

const { config } = require('./config');
const { proxyRequest, sleep } = require('./http');
const log = require('./logger');

let token = null;

async function adminFetch(path, { method = 'GET', body, auth = true } = {}) {
  const res = await fetch(`${config.adminApiUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });

  if (res.status === 204) return null;

  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    // A silent fixture failure looks exactly like a limiter bug. Be loud.
    throw new Error(
      `Admin API ${method} ${path} failed: ${res.status} ${parsed ? JSON.stringify(parsed) : text}`
    );
  }
  return parsed;
}

async function login() {
  const result = await adminFetch('/v1/admin/login', {
    method: 'POST',
    auth: false,
    body: { username: config.adminUsername, password: config.adminPassword },
  });
  token = result.token;
  log.info('admin_login_ok', { expiresIn: result.expires_in });
  return token;
}

async function createTenant(name) {
  const tenant = await adminFetch('/v1/admin/tenants', {
    method: 'POST',
    body: { name, plan: 'free' },
  });
  // api_key is returned exactly once, here.
  log.info('tenant_created', { tenantId: tenant.id, name: tenant.name });
  return tenant;
}

async function deleteTenant(id) {
  await adminFetch(`/v1/admin/tenants/${id}`, { method: 'DELETE' });
  log.info('tenant_deleted', { tenantId: id });
}

async function createPolicy(spec) {
  const policy = await adminFetch('/v1/admin/policies', { method: 'POST', body: spec });
  log.info('policy_created', {
    policyId: policy.id,
    route: policy.route_pattern,
    algorithm: policy.algorithm,
    limit: policy.limit_count,
  });
  return policy;
}

async function deletePolicy(id) {
  await adminFetch(`/v1/admin/policies/${id}`, { method: 'DELETE' });
}

/**
 * Polls the WARMUP route, never the proof route: probing the route under test
 * would consume tokens from the very bucket the proof is about to count.
 * Waits until `expectedNodes` distinct replicas have answered 200, because a
 * single 200 only proves one replica warmed its cache.
 */
async function waitForPropagation({ apiKey }) {
  const deadline = Date.now() + config.propagationTimeoutMs;
  const warmNodes = new Set();

  while (Date.now() < deadline) {
    const result = await proxyRequest({ apiKey, route: config.warmupRoute });
    if (result.status === 200 && result.node) warmNodes.add(result.node);
    if (warmNodes.size >= config.expectedNodes) {
      log.info('propagation_complete', { warmNodes: [...warmNodes] });
      return [...warmNodes];
    }
    await sleep(50);
  }

  if (warmNodes.size === 0) {
    throw new Error(
      `Config never propagated within ${config.propagationTimeoutMs}ms — no replica accepted the new API key. ` +
        'Check the Admin API published config:invalidate and the gateways are subscribed.'
    );
  }

  log.warn('propagation_partial', {
    warmNodes: [...warmNodes],
    expected: config.expectedNodes,
    note: 'proceeding — cold replicas will read Postgres on first request',
  });
  return [...warmNodes];
}

module.exports = {
  login,
  createTenant,
  deleteTenant,
  createPolicy,
  deletePolicy,
  waitForPropagation,
};