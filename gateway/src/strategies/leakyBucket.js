'use strict';

const { runScript } = require('../config/redis');
const { baseKey } = require('./tokenBucket');

const BUCKET_TTL_SECONDS = Number(process.env.BUCKET_TTL_SECONDS || 3600);

async function check({ tenantId, policy, effectiveLimit }) {
  const key = `${baseKey(tenantId, policy)}:lb`;
  const leakRate = Number(policy.refill_rate || 0);

  const [allowed, remaining, resetMs] = await runScript(
    'leakyBucket',
    [key],
    [effectiveLimit, leakRate, BUCKET_TTL_SECONDS]
  );

  const reset =
    Number(resetMs) === -1
      ? Number(policy.window_seconds || BUCKET_TTL_SECONDS)
      : Math.max(0, Math.ceil(Number(resetMs) / 1000));

  return {
    allowed: allowed === 1,
    limit: effectiveLimit,
    remaining: Number(remaining),
    resetSeconds: reset,
    reasonCode: allowed === 1 ? 'OK' : 'LIMIT_EXCEEDED',
  };
}

module.exports = { name: 'leaky_bucket', check };