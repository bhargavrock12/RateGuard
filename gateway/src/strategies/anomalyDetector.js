'use strict';

const logger = require('../utils/logger');

const ENABLED = process.env.ANOMALY_ENABLED === 'true';

/**
 * M7: Adaptive anomaly limiter stub.
 * Safely bypassed for M1-M6 since ANOMALY_ENABLED defaults to false.
 */
async function getPenalty({ tenantId, policy }) {
  if (!ENABLED) {
    return { multiplier: 1, throttled: false };
  }
  return { multiplier: 1, throttled: false };
}

module.exports = { getPenalty };