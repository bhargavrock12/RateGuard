'use strict';

const { config } = require('./config');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Never throws on an HTTP status; network failures become { status: 0, error }. */
async function proxyRequest({ apiKey, route, method = 'GET', body = undefined }) {
  const url = `${config.gatewayUrl}/v1/proxy${route}`;
  const startedAt = process.hrtime.bigint();

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'X-API-Key': apiKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });

    let parsed = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }

    return {
      status: res.status,
      node: res.headers.get('x-gateway-node'),
      limit: numOrNull(res.headers.get('x-ratelimit-limit')),
      remaining: numOrNull(res.headers.get('x-ratelimit-remaining')),
      reset: numOrNull(res.headers.get('x-ratelimit-reset')),
      retryAfter: numOrNull(res.headers.get('retry-after')),
      requestId: res.headers.get('x-request-id'),
      reasonCode: parsed?.error?.code ?? null,
      body: parsed,
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
      error: null,
    };
  } catch (err) {
    // Expected during the node-kill run: count it, do not abort the batch.
    return {
      status: 0,
      node: null,
      limit: null,
      remaining: null,
      reset: null,
      retryAfter: null,
      requestId: null,
      reasonCode: null,
      body: null,
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
      error: err.message,
    };
  }
}

function numOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Builds every promise before awaiting. A `for … await` loop here would serialise
 * the burst and the proof would pass even against a broken per-node limiter.
 */
function fireConcurrent(count, factory) {
  const pending = [];
  for (let i = 0; i < count; i += 1) pending.push(factory(i));
  return Promise.all(pending);
}

module.exports = { proxyRequest, fireConcurrent, sleep };