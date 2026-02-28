'use strict';

const { getPoliciesForTenant } = require('../config/policyCache');
const { getPenalty } = require('../strategies/anomalyDetector');
const {
  requestsTotal,
  decisionLatency,
  redisUnavailableTotal,
  anomalyThrottleTotal,
} = require('../routes/metrics');
const { AppError, ERROR_CODES, buildErrorBody } = require('../utils/errors');
const logger = require('../utils/logger');

const STRATEGIES = {
  token_bucket: require('../strategies/tokenBucket'),
  // We will add the other strategies in later milestones
};

const FAIL_OPEN = process.env.FAIL_OPEN !== 'false'; // frozen F5: open by default
const NO_POLICY_BEHAVIOR = process.env.NO_POLICY_BEHAVIOR || 'allow';

/**
 * Exact pattern wins; otherwise the longest matching wildcard prefix wins.
 */
function matchPolicy(policies, path) {
  let best = null;
  let bestScore = -1;

  for (const policy of policies) {
    const pattern = policy.route_pattern;
    if (pattern === path) return policy;

    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (path.startsWith(prefix) && prefix.length > bestScore) {
        best = policy;
        bestScore = prefix.length;
      }
    }
  }
  return best;
}

function setHeaders(res, decision) {
  res.set('X-RateLimit-Limit', String(decision.limit));
  res.set('X-RateLimit-Remaining', String(Math.max(0, decision.remaining)));
  res.set('X-RateLimit-Reset', String(decision.resetSeconds));
}

async function rateLimit(req, res, next) {
  const tenantId = req.tenant.id;
  const path = req.upstreamPath;

  let policy;
  try {
    policy = matchPolicy(await getPoliciesForTenant(tenantId), path);
  } catch (err) {
    logger.error('policy_lookup_failed', { requestId: req.requestId, err: err.message });
    policy = null;
  }

  if (!policy) {
    if (NO_POLICY_BEHAVIOR === 'deny') {
      return next(new AppError(ERROR_CODES.NO_POLICY, 'No rate-limit policy matches this route', 403));
    }
    logger.debug('no_policy_match_allowing', { requestId: req.requestId, tenantId, path });
    return next();
  }

  const strategy = STRATEGIES[policy.algorithm];
  if (!strategy) {
    logger.error('unknown_algorithm', { requestId: req.requestId, algorithm: policy.algorithm });
    return next(); // never break traffic over a bad config row
  }

  const stopTimer = decisionLatency.startTimer({ algorithm: policy.algorithm });

  try {
    // Note: getPenalty is a mock for now, we build the real anomalyDetector in M7.
    // The architecture spec allows us to stub this early.
    const multiplier = 1; 
    const throttled = false;
    
    const effectiveLimit = Math.max(1, Math.floor(Number(policy.limit_count) * multiplier));
    if (throttled) anomalyThrottleTotal.inc({ tenant: tenantId });

    const decision = await strategy.check({ tenantId, route: path, policy, effectiveLimit });
    stopTimer();

    setHeaders(res, decision);
    requestsTotal.inc({
      tenant: tenantId,
      route: policy.route_pattern,
      decision: decision.allowed ? 'allow' : 'deny',
      algorithm: policy.algorithm,
    });

    if (decision.allowed) return next();

    const reasonCode = throttled ? ERROR_CODES.ANOMALY_THROTTLE : decision.reasonCode;
    res.set('Retry-After', String(Math.max(1, decision.resetSeconds)));
    return res
      .status(429)
      .json(buildErrorBody(reasonCode, 'Rate limit exceeded', req.requestId));
  } catch (err) {
    stopTimer();
    // Redis unreachable / timed out -> frozen F5
    redisUnavailableTotal.inc({ action: FAIL_OPEN ? 'fail_open' : 'fail_closed' });
    logger.error('limiter_unavailable', {
      requestId: req.requestId,
      tenantId,
      failOpen: FAIL_OPEN,
      err: err.message,
    });

    if (FAIL_OPEN) return next();
    return next(new AppError(ERROR_CODES.INTERNAL_ERROR, 'Rate limiter unavailable', 503));
  }
}

module.exports = { rateLimit, matchPolicy };