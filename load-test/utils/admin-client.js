// load-test/utils/admin-client.js
'use strict';

const log = require('./logger');

// Self-contained sleep helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function login() {
  log.debug('M2 Stub: Bypassing Admin API login');
  return 'fake_admin_token';
}

async function createTenant(name) {
  log.debug('M2 Stub: Bypassing Admin API tenant creation', { name });
  // Use the verified raw key that matches your M1 static hash ('test-key')
  return { id: 't_m2_mock', api_key: 'test-key', name };
}

async function deleteTenant(id) {
  log.debug('M2 Stub: Bypassing Admin API tenant deletion', { id });
}

async function createPolicy(spec) {
  log.debug('M2 Stub: Bypassing Admin API policy creation', { route: spec.route_pattern });
  return { id: 'p_m2_mock', ...spec };
}

async function deletePolicy(id) {
  log.debug('M2 Stub: Bypassing Admin API policy deletion', { id });
}

async function waitForPropagation({ apiKey }) {
  log.debug('M2 Stub: Simulating WARMUP cache propagation wait...');
  await sleep(100);
  return ['gateway-1', 'gateway-2', 'gateway-3'];
}

module.exports = {
  login,
  createTenant,
  deleteTenant,
  createPolicy,
  deletePolicy,
  waitForPropagation,
};