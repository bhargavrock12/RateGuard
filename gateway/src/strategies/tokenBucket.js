'use strict';

const { runScript } = require('../config/redis');

const BUCKET_TTL_SECONDS = Number(process.env.BUCKET_TTL_SECONDS || 3600);

function baseKey(tenantId, policy) {
  return `rl:${tenantId}:${policy.route_pattern}`;
}

function resolveReset(resetMs, policy) {
  if (resetMs === -1) return Number(policy.window_seconds || BUCKET_TTL_SECONDS);
  return Math.max(0, Math.ceil(resetMs / 1000));
}

async function check({ tenantId, policy, effectiveLimit }) {
  const key = `${baseKey(tenantId, policy)}:tb`;
  const capacity = effectiveLimit;
  const refillRate = Number(policy.refill_rate || 0);

  const [allowed, remaining, resetMs] = await runScript(
    'tokenBucket',
    [key],
    [capacity, refillRate, BUCKET_TTL_SECONDS]
  );

  return {
    allowed: allowed === 1,
    limit: capacity,
    remaining: Number(remaining),
    resetSeconds: resolveReset(Number(resetMs), policy),
    reasonCode: allowed === 1 ? 'OK' : 'LIMIT_EXCEEDED',
  };
}

module.exports = { name: 'token_bucket', check, baseKey };