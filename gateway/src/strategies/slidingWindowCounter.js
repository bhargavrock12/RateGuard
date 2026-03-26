'use strict';

const { runScript } = require('../config/redis');
const { baseKey } = require('./tokenBucket');

async function check({ tenantId, policy, effectiveLimit }) {
  const windowMs = Number(policy.window_seconds || 60) * 1000;

  const [allowed, remaining, resetMs] = await runScript(
    'slidingWindowCounter',
    [baseKey(tenantId, policy)],
    [effectiveLimit, windowMs]
  );

  return {
    allowed: allowed === 1,
    limit: effectiveLimit,
    remaining: Number(remaining),
    resetSeconds: Math.max(0, Math.ceil(Number(resetMs) / 1000)),
    reasonCode: allowed === 1 ? 'OK' : 'LIMIT_EXCEEDED',
  };
}

module.exports = { name: 'sliding_window_counter', check };