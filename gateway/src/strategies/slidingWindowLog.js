'use strict';

const { ulid } = require('ulid');
const { runScript } = require('../config/redis');
const { baseKey } = require('./tokenBucket');

async function check({ tenantId, policy, effectiveLimit }) {
  const windowMs = Number(policy.window_seconds || 60) * 1000;
  const key = `${baseKey(tenantId, policy)}:swl`;

  const [allowed, remaining, resetMs] = await runScript(
    'slidingWindowLog',
    [key],
    [windowMs, effectiveLimit, ulid()]
  );

  return {
    allowed: allowed === 1,
    limit: effectiveLimit,
    remaining: Number(remaining),
    resetSeconds: Math.max(0, Math.ceil(Number(resetMs) / 1000)),
    reasonCode: allowed === 1 ? 'OK' : 'LIMIT_EXCEEDED',
  };
}

module.exports = { name: 'sliding_window_log', check };