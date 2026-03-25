-- Sliding window counter. Weighted previous-window approximation.
-- KEYS[1] = base key prefix, e.g. rl:{tenant}:{route}
-- ARGV[1] = limit, ARGV[2] = window_ms 
-- returns {allowed, remaining, reset_ms}

if redis.replicate_commands then redis.replicate_commands() end

local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local base      = KEYS[1]
local limit     = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])

local window_id = math.floor(now / window_ms)
local elapsed   = now % window_ms
local cur_key   = base .. ':swc:' .. window_id
local prev_key  = base .. ':swc:' .. (window_id - 1)

local current   = tonumber(redis.call('GET', cur_key) or '0')
local previous  = tonumber(redis.call('GET', prev_key) or '0')
local weight    = (window_ms - elapsed) / window_ms
local estimated = previous * weight + current

local allowed = 0
if estimated < limit then
  redis.call('INCR', cur_key)
  redis.call('EXPIRE', cur_key, math.ceil(window_ms / 1000) * 2)
  estimated = estimated + 1
  allowed = 1
end

local remaining = math.max(0, math.floor(limit - estimated))
return { allowed, remaining, window_ms - elapsed }
