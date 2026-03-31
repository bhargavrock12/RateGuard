'use strict';

const { registerScript, runScript } = require('../config/redis');
const { baseKey } = require('./tokenBucket');

// Strawman: INCR + EXPIRE on a window-keyed counter, kept atomic via an inline script.
registerScript(
  'fixedWindow',
  `
if redis.replicate_commands then redis.replicate_commands() end
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local base      = KEYS[1]
local limit     = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])

local window_id = math.floor(now / window_ms)
local elapsed   = now % window_ms 
local key       = base .. ':fw:' .. window_id

local count = tonumber(redis.call('GET', key) or '0')
local allowed = 0
if count < limit then
  count = redis.call('INCR', key)
  redis.call('EXPIRE', key, math.ceil(window_ms / 1000) + 1)
  allowed = 1
end

return { allowed, math.max(0, limit - count), window_ms - elapsed }
`
);

async function check({ tenantId, policy, effectiveLimit }) {
  const windowMs = Number(policy.window_seconds || 60) * 1000;

  const [allowed, remaining, resetMs] = await runScript(
    'fixedWindow',
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

module.exports = { name: 'fixed_window', check };