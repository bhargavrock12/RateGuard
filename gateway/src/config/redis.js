'use strict';

const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const logger = require('../utils/logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const COMMAND_TIMEOUT_MS = Number(process.env.REDIS_COMMAND_TIMEOUT_MS || 200);

const clientOptions = {
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
  commandTimeout: COMMAND_TIMEOUT_MS,
  retryStrategy: (times) => Math.min(times * 200, 2000),
};

const client = new Redis(REDIS_URL, clientOptions);
const subscriber = new Redis(REDIS_URL, { ...clientOptions, commandTimeout: undefined });

let healthy = false;

client.on('ready', () => {
  healthy = true;
  logger.info('redis_ready');
});
client.on('end', () => {
  healthy = false;
  logger.warn('redis_connection_ended');
});
client.on('error', (err) => {
  healthy = false;
  logger.error('redis_error', { err: err.message });
});
subscriber.on('error', (err) => logger.error('redis_subscriber_error', { err: err.message }));

/** name -> { source, sha } */
const scripts = new Map();

function registerScript(name, source) {
  scripts.set(name, { source, sha: null });
}

function loadScriptFiles() {
  const dir = path.join(__dirname, '..', 'lua');
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.lua')) continue;
    const name = path.basename(file, '.lua');
    registerScript(name, fs.readFileSync(path.join(dir, file), 'utf8'));
  }
}

async function primeScripts() {
  for (const [name, entry] of scripts) {
    try {
      entry.sha = await client.script('LOAD', entry.source);
      logger.debug('lua_script_loaded', { name, sha: entry.sha });
    } catch (err) {
      logger.warn('lua_script_load_failed', { name, err: err.message });
    }
  }
}

/**
 * Execute a registered Lua script atomically.
 * Falls back to EVAL if Redis has forgotten the SHA (e.g. after a restart).
 */
async function runScript(name, keys = [], argv = []) {
  const entry = scripts.get(name);
  if (!entry) throw new Error(`Unknown Lua script: ${name}`);

  const args = [String(keys.length), ...keys.map(String), ...argv.map(String)];

  if (entry.sha) {
    try {
      return await client.evalsha(entry.sha, ...args);
    } catch (err) {
      if (!String(err.message).includes('NOSCRIPT')) throw err;
      logger.warn('lua_noscript_reloading', { name });
    }
  }

  const result = await client.eval(entry.source, ...args);
  entry.sha = await client.script('LOAD', entry.source).catch(() => null);
  return result;
}

async function initRedis() {
  loadScriptFiles();
  if (client.status !== 'ready') {
    await new Promise((resolve) => {
      if (client.status === 'ready') return resolve();
      client.once('ready', resolve);
      client.once('error', resolve); // do not block startup; fail-open covers us
    });
  }
  await primeScripts();
}

async function closeRedis() {
  await Promise.allSettled([client.quit(), subscriber.quit()]);
}

module.exports = {
  client,
  getSubscriber: () => subscriber,
  isRedisHealthy: () => healthy,
  registerScript,
  runScript,
  initRedis,
  closeRedis,
};