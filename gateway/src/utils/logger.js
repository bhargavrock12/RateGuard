'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;
const NODE_ID = process.env.NODE_ID || 'gateway';

const REDACTED_HEADERS = new Set(['x-api-key', 'authorization', 'cookie', 'set-cookie']);

/** Returns a copy of headers with credential-bearing values masked. */
function redactHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = REDACTED_HEADERS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}

function emit(level, msg, fields) {
  if (LEVELS[level] < threshold) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    node: NODE_ID,
    msg,
    ...fields,
  };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

module.exports = {
  debug: (msg, fields) => emit('debug', msg, fields),
  info: (msg, fields) => emit('info', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  error: (msg, fields) => emit('error', msg, fields),
  redactHeaders,
};