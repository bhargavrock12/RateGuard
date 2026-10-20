'use strict';

const { registerScript, runScript, client } = require('../config/redis');
const { baseKey } = require('./tokenBucket');
const logger = require('../utils/logger');

const ENABLED = process.env.ANOMALY_ENABLED === 'true';
const BUCKET_SECONDS = Number(process.env.ANOMALY_BUCKET_SECONDS || 10);
const MAX_BUCKETS = Number(process.env.ANOMALY_MAX_BUCKETS || 30);
const Z_THRESHOLD = Number(process.env.ANOMALY_Z_THRESHOLD || 3);
const PENALTY_MULTIPLIER = Number(process.env.ANOMALY_PENALTY_MULTIPLIER || 0.3);
const COOLDOWN_SECONDS = Number(process.env.ANOMALY_COOLDOWN_SECONDS || 300);
const MIN_SAMPLES = Number(process.env.ANOMALY_MIN_SAMPLES || 5);

// Rolls the 10s bucket, records history, and reports the current penalty state atomically.
registerScript(
  'anomalyObserve',
  `
if redis.replicate_commands then redis.replicate_commands() end
local t = redis.call('TIME')
local now = tonumber(t[1])

local hist_key = KEYS[1]
local cur_key  = KEYS[2]
local pen_key  = KEYS[3]

local bucket_seconds = tonumber(ARGV[1])
local max_buckets    = tonumber(ARGV[2])
local bucket_id      = math.floor(now / bucket_seconds)

local cur        = redis.call('HMGET', cur_key, 'bucket', 'count')
local cur_bucket = tonumber(cur[1])
local cur_count  = tonumber(cur[2]) or 0

if cur_bucket == nil then
  cur_bucket = bucket_id
  cur_count = 0
elseif cur_bucket ~= bucket_id then
  redis.call('LPUSH', hist_key, cur_count)
  redis.call('LTRIM', hist_key, 0, max_buckets - 1)
  redis.call('EXPIRE', hist_key, bucket_seconds * (max_buckets + 2))
  cur_bucket = bucket_id
  cur_count = 0
end

cur_count = cur_count + 1
redis.call('HMSET', cur_key, 'bucket', cur_bucket, 'count', cur_count)
redis.call('EXPIRE', cur_key, bucket_seconds * 2)

local penalised = 0
if redis.call('GET', pen_key) then penalised = 1 end

local hist = redis.call('LRANGE', hist_key, 0, max_buckets - 1)
return { cur_count, penalised, hist }
`
);

function zScore(current, history) {
  if (history.length < MIN_SAMPLES) return 0;
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const variance =
    history.reduce((acc, v) => acc + (v - mean) ** 2, 0) / history.length;
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return 0;
  return (current - mean) / stddev;
}

/** Returns the multiplier to apply to the configured limit. */
async function getPenalty({ tenantId, policy }) {
  if (!ENABLED) return { multiplier: 1, throttled: false };

  const base = baseKey(tenantId, policy);
  const histKey = `${base}:hist`;
  const curKey = `${base}:histcur`;
  const penKey = `${base}:pen`;

  const [current, penalised, rawHistory] = await runScript(
    'anomalyObserve',
    [histKey, curKey, penKey],
    [BUCKET_SECONDS, MAX_BUCKETS]
  );

  if (Number(penalised) === 1) {
    return { multiplier: PENALTY_MULTIPLIER, throttled: true };
  }

  const history = (rawHistory || []).map(Number).filter((n) => Number.isFinite(n));
  const z = zScore(Number(current), history);

  if (z > Z_THRESHOLD) {
    await client.set(penKey, '1', 'EX', COOLDOWN_SECONDS, 'NX');
    logger.warn('anomaly_detected', { tenantId, route: policy.route_pattern, z: Number(z.toFixed(2)) });
    return { multiplier: PENALTY_MULTIPLIER, throttled: true };
  }

  return { multiplier: 1, throttled: false };
}

module.exports = { getPenalty };