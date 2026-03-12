'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;
const JSON_MODE = process.env.LOG_JSON === 'true';
const NODE_ID = 'load-test';

const PREFIX = { debug: '  ·', info: '  ›', warn: '  !', error: '  ✗' };

function emit(level, msg, fields) {
  if (LEVELS[level] < threshold) return;
  if (JSON_MODE) {
    // Same shape as gateway/admin-api: correlatable across all three log streams.
    process.stdout.write(
      `${JSON.stringify({ ts: new Date().toISOString(), level, node: NODE_ID, msg, ...fields })}\n`
    );
    return;
  }
  const extra = fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
  process.stdout.write(`${PREFIX[level]} ${msg}${extra}\n`);
}

module.exports = {
  debug: (msg, fields) => emit('debug', msg, fields),
  info: (msg, fields) => emit('info', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  error: (msg, fields) => emit('error', msg, fields),
  step: (msg) => {
    if (JSON_MODE) return emit('info', msg, { phase: true });
    process.stdout.write(`\n\x1b[1m${msg}\x1b[0m\n`);
  },
  // Pre-formatted output (tables) must not be JSON-wrapped.
  raw: (text) => process.stdout.write(`${text}\n`),
};