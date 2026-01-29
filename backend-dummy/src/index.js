'use strict';

const express = require('express');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 4000);
const NODE_ID = process.env.NODE_ID || 'backend-dummy';
const DEFAULT_LATENCY_MS = Number(process.env.DEFAULT_LATENCY_MS || 0);
// Kept below the gateway's PROXY_TIMEOUT_MS so a slow response is attributable here.
const MAX_LATENCY_MS = Number(process.env.MAX_LATENCY_MS || 10000);

// --- Logging: format copied verbatim from gateway/src/utils/logger.js -------
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;
const REDACTED_HEADERS = new Set(['x-api-key', 'authorization', 'cookie', 'set-cookie']);

function log(level, msg, fields) {
  if (LEVELS[level] < threshold) return;
  const line = { ts: new Date().toISOString(), level, node: NODE_ID, msg, ...fields };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

/** The gateway already strips x-api-key; this is defence in depth. */
function redactHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = REDACTED_HEADERS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}

// --- Knob parsing -----------------------------------------------------------
function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function resolveDelayMs(req) {
  const raw = req.query.delay_ms ?? req.get('x-dummy-delay-ms');
  if (raw === undefined) return clampInt(DEFAULT_LATENCY_MS, 0, MAX_LATENCY_MS, 0);
  return clampInt(raw, 0, MAX_LATENCY_MS, 0);
}

function resolveStatus(req) {
  const raw = req.query.status ?? req.get('x-dummy-status');
  if (raw === undefined) return 200;
  return clampInt(raw, 200, 599, 200);
}

/** Best-effort only: a forwarded body must never be a reason this service errors. */
function parseBody(raw, contentType = '') {
  if (!raw || raw.length === 0) return null;
  const type = contentType.toLowerCase();
  if (type.includes('json')) {
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      return { unparsed: true, bytes: raw.length };
    }
  }
  if (type.startsWith('text/') || type.includes('urlencoded') || type === '') {
    return raw.toString('utf8').slice(0, 4096);
  }
  return { binary: true, bytes: raw.length };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- App --------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // always behind nginx + the gateway

// Raw capture: the gateway forwards arbitrary content types untouched.
app.use(express.raw({ type: '*/*', limit: '1mb' }));

app.use((req, res, next) => {
  req.requestId = req.get('x-request-id') || crypto.randomUUID();
  req.startedAt = process.hrtime.bigint();
  res.set('X-Request-Id', req.requestId);
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - req.startedAt) / 1e6;
    log('info', 'upstream_request', {
      requestId: req.requestId,
      tenantId: req.get('x-tenant-id') || null,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      bytes: req.body ? req.body.length : 0, // never log the body itself
      durationMs: Number(durationMs.toFixed(2)),
    });
  });
  next();
});

// Registered before the catch-all — the only reserved path in this service.
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'backend-dummy', node: NODE_ID });
});

async function echoHandler(req, res) {
  const delayMs = resolveDelayMs(req);
  const status = resolveStatus(req);

  if (delayMs > 0) await sleep(delayMs);

  if (status >= 400) {
    // Opt-in failure injection, so the gateway's 502/UPSTREAM_ERROR path is testable.
    return res.status(status).json({
      error: {
        code: 'SIMULATED_UPSTREAM_FAILURE',
        message: `Upstream failure simulated with status ${status}`,
        requestId: req.requestId,
      },
    });
  }

  return res.status(status).json({
    service: 'backend-dummy',
    node: NODE_ID,
    ok: true,
    method: req.method,
    path: req.path,
    query: req.query,
    tenant_id: req.get('x-tenant-id') || null,
    request_id: req.requestId,
    headers: redactHeaders(req.headers),
    body: parseBody(req.body, req.get('content-type') || ''),
    simulated_delay_ms: delayMs,
    received_at: new Date().toISOString(),
  });
}

// Catch-all: any method, any path. There is no 404 here by design — the gateway
// decides what may be forwarded; this service accepts whatever arrives.
app.all(/.*/, (req, res, next) => {
  echoHandler(req, res).catch(next);
});

// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature
app.use((err, req, res, _next) => {
  log('error', 'unhandled_error', { requestId: req.requestId, error: err.message });
  if (res.headersSent) return;
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Unexpected error in backend-dummy',
      requestId: req.requestId,
    },
  });
});

// --- Lifecycle --------------------------------------------------------------
const server = app.listen(PORT, () => {
  log('info', 'backend_dummy_started', { port: PORT, defaultLatencyMs: DEFAULT_LATENCY_MS });
});

function shutdown(signal) {
  log('info', 'shutdown_started', { signal });
  server.close(() => {
    log('info', 'shutdown_complete', { signal });
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM')); // what Docker sends
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server };