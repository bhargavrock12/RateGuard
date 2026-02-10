-- Token bucket. Atomic refill + consume.
-- KEYS[1] = rl:{tenant}:{route}:tb
-- ARGV[1] = capacity, ARGV[2] = refill_rate (tokens/sec), ARGV[3] = ttl_seconds
-- returns {allowed, remaining, reset_ms}   (reset_ms = -1 means "never refills")

if redis.replicate_commands then redis.replicate_commands() end

local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local capacity    = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local ttl         = tonumber(ARGV[3])

local bucket      = redis.call('HMGET', KEYS[1], 'tokens', 'last_refill')
local tokens      = tonumber(bucket[1])
local last_refill = tonumber(bucket[2])

if tokens == nil or last_refill == nil then
  tokens = capacity
  last_refill = now
end

local elapsed = math.max(0, now - last_refill) / 1000
tokens = math.min(capacity, tokens + elapsed * refill_rate)

local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end

redis.call('HMSET', KEYS[1], 'tokens', tokens, 'last_refill', now)
redis.call('EXPIRE', KEYS[1], ttl)

local reset_ms = 0
if allowed == 0 then
  if refill_rate > 0 then
    reset_ms = math.ceil(((1 - tokens) / refill_rate) * 1000)
  else
    reset_ms = -1
  end
end

return { allowed, math.floor(tokens), reset_ms }