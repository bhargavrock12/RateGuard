'use strict';

const { Pool } = require('pg');
const { getSubscriber } = require('./redis');
const logger = require('../utils/logger');

const TTL_MS = Number(process.env.POLICY_CACHE_TTL_MS || 30000);
const INVALIDATE_CHANNEL = 'config:invalidate';
const DATABASE_URL = process.env.DATABASE_URL || '';

const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, max: 5 }) : null;

const tenantByHash = new Map(); // hash -> { value, expiresAt }
const policiesByTenant = new Map(); // tenantId -> { value, expiresAt }
let warm = false;

function put(map, key, value) {
  map.set(key, { value, expiresAt: Date.now() + TTL_MS });
  warm = true;
  return value;
}

function get(map, key) {
  const hit = map.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    map.delete(key);
    return undefined;
  }
  return hit.value;
}

/* ---------- M1 static fallback (no Postgres required) ---------- */

function staticTenant() {
  if (!process.env.STATIC_API_KEY_HASH) return null;
  return {
    hash: process.env.STATIC_API_KEY_HASH,
    tenant: { id: process.env.STATIC_TENANT_ID || 'static-tenant', name: 'static', plan: 'free' },
    policies: [
      {
        id: 'static-policy',
        route_pattern: process.env.STATIC_ROUTE_PATTERN || '/*',
        algorithm: process.env.STATIC_ALGORITHM || 'token_bucket',
        limit_count: Number(process.env.STATIC_LIMIT_COUNT || 20),
        window_seconds: Number(process.env.STATIC_WINDOW_SECONDS || 60),
        refill_rate: Number(process.env.STATIC_REFILL_RATE || 0),
      },
    ],
  };
}

/* ---------- lookups ---------- */

async function getTenantByKeyHash(hash) {
  const cached = get(tenantByHash, hash);
  if (cached !== undefined) return cached;

  const fallback = staticTenant();
  if (fallback && fallback.hash === hash) return put(tenantByHash, hash, fallback.tenant);

  if (!pool) return put(tenantByHash, hash, null);

  const { rows } = await pool.query(
    'SELECT id, name, plan FROM tenants WHERE api_key_hash = $1 LIMIT 1',
    [hash]
  );
  return put(tenantByHash, hash, rows[0] || null);
}

async function getPoliciesForTenant(tenantId) {
  const cached = get(policiesByTenant, tenantId);
  if (cached !== undefined) return cached;

  const fallback = staticTenant();
  if (fallback && fallback.tenant.id === tenantId) {
    return put(policiesByTenant, tenantId, fallback.policies);
  }

  if (!pool) return put(policiesByTenant, tenantId, []);

  const { rows } = await pool.query(
    `SELECT id, route_pattern, algorithm, limit_count, window_seconds, refill_rate
        FROM rate_limit_policies
       WHERE tenant_id = $1`,
    [tenantId]
  );
  return put(policiesByTenant, tenantId, rows);
}

/* ---------- invalidation ---------- */

function invalidateTenant(tenantId) {
  policiesByTenant.delete(tenantId);
  for (const [hash, entry] of tenantByHash) {
    if (entry.value && entry.value.id === tenantId) tenantByHash.delete(hash);
  }
  logger.info('policy_cache_invalidated', { tenantId });
}

async function initPolicyCache() {
  const sub = getSubscriber();
  await sub.subscribe(INVALIDATE_CHANNEL);
  sub.on('message', (channel, raw) => {
    if (channel !== INVALIDATE_CHANNEL) return;
    try {
      const { tenant_id: tenantId } = JSON.parse(raw);
      if (tenantId) invalidateTenant(tenantId);
    } catch (err) {
      logger.warn('invalid_invalidation_message', { raw, err: err.message });
    }
  });
  logger.info('policy_cache_subscribed', { channel: INVALIDATE_CHANNEL, ttlMs: TTL_MS });
}

async function closePolicyCache() {
  if (pool) await pool.end();
}

module.exports = {
  initPolicyCache,
  closePolicyCache,
  getTenantByKeyHash,
  getPoliciesForTenant,
  invalidateTenant,
  isCacheWarm: () => warm,
};