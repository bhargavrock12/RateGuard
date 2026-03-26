-- Sliding window log. Exact, ZSET-backed.
-- KEYS[1] = rl:{tenant}:{route}:swl
-- ARGV[1] = window_ms, ARGV[2] = limit, ARGV[3] = unique_id (ULID)
-- returns {allowed, remaining, reset_ms}

if redis.replicate_commands then redis.replicate_commands() end

local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local window_ms = tonumber(ARGV[1])
local limit     = tonumber(ARGV[2])
local uid       = ARGV[3]

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window_ms)

local count   = redis.call('ZCARD', KEYS[1])
local allowed = 0
if count < limit then
  redis.call('ZADD', KEYS[1], now, uid)
  count = count + 1
  allowed = 1
end

redis.call('PEXPIRE', KEYS[1], window_ms + 1000)

local reset_ms = window_ms
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
if oldest[2] then
  reset_ms = math.max(0, math.ceil(tonumber(oldest[2]) + window_ms - now))
end

return { allowed, math.max(0, limit - count), reset_ms }