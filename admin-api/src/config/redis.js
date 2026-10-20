'use strict';

const Redis = require('ioredis');
const env = require('./env');
const logger = require('../utils/logger');

const INVALIDATE_CHANNEL = 'config:invalidate';

const publisher = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

let healthy = false;
publisher.on('ready', () => {
  healthy = true;
  logger.info('redis_publisher_ready', { channel: INVALIDATE_CHANNEL });
});
publisher.on('end', () => {
  healthy = false;
});
publisher.on('error', (err) => {
  healthy = false;
  logger.error('redis_publisher_error', { err: err.message });
});

/**
 * Tell every gateway node to evict this tenant's cached config.
 * Best-effort: the gateway's cache TTL is the safety net.
 */
async function publishInvalidate(tenantId) {
  try {
    const receivers = await publisher.publish(
      INVALIDATE_CHANNEL,
      JSON.stringify({ tenant_id: tenantId })
    );
    logger.info('config_invalidate_published', { tenantId, receivers });
    return true;
  } catch (err) {
    logger.error('config_invalidate_failed', { tenantId, err: err.message });
    return false;
  }
}

async function closeRedis() {
  await publisher.quit().catch(() => {});
}

module.exports = {
  INVALIDATE_CHANNEL,
  publishInvalidate,
  isRedisHealthy: () => healthy,
  closeRedis,
};