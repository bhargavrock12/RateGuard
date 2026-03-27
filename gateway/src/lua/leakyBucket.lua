-- Leaky bucket. Constant outflow, no burst credit.
-- KEYS[1] = rl:{tenant}:{route}:lb
-- ARGV[1] = capacity, ARGV[2] = leak_rate (req/sec), ARGV[3] = ttl_seconds
-- returns {allowed, remaining, reset_ms}   (reset_ms = -1 means "never drains")

if redis.replicate_commands then redis.replicate_commands() end

local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local capacity  = tonumber(ARGV[1])
local leak_rate = tonumber(ARGV[2])
local ttl       = tonumber(ARGV[3])

local bucket    = redis.call('HMGET', KEYS[1], 'level', 'last_leak')
local level     = tonumber(bucket[1]) or 0
local last_leak = tonumber(bucket[2]) or now

local elapsed = math.max(0, now - last_leak) / 1000
level = math.max(0, level - elapsed * leak_rate)

local allowed = 0
if level + 1 <= capacity then
  level = level + 1
  allowed = 1
end

redis.call('HMSET', KEYS[1], 'level', level, 'last_leak', now)
redis.call('EXPIRE', KEYS[1], ttl) 

local reset_ms = 0
if allowed == 0 then
  if leak_rate > 0 then
    reset_ms = math.ceil(((level - (capacity - 1)) / leak_rate) * 1000)
  else
    reset_ms = -1
  end
end

return { allowed, math.max(0, math.floor(capacity - level)), reset_ms }