'use strict';

const httpProxy = require('http-proxy');
const { buildErrorBody, ERROR_CODES } = require('../utils/errors');
const logger = require('../utils/logger');

const UPSTREAM_URL = process.env.UPSTREAM_URL || 'http://backend-dummy:4000';
const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 10000);

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  proxyTimeout: PROXY_TIMEOUT_MS,
  timeout: PROXY_TIMEOUT_MS,
});

proxy.on('proxyReq', (proxyReq, req) => {
  proxyReq.removeHeader('x-api-key'); // never forward the credential
  if (req.tenant) proxyReq.setHeader('x-tenant-id', req.tenant.id);
  if (req.requestId) proxyReq.setHeader('x-request-id', req.requestId);
});

proxy.on('error', (err, req, res) => {
  logger.error('upstream_error', { requestId: req.requestId, err: err.message });
  if (res.headersSent || res.writableEnded) return;
  res
    .status(502)
    .json(buildErrorBody(ERROR_CODES.UPSTREAM_ERROR, 'Upstream request failed', req.requestId));
});

function forward(req, res) {
  req.url = req.upstreamPath + (req.originalUrl.includes('?') ? `?${req.originalUrl.split('?')[1]}` : '');
  proxy.web(req, res, { target: UPSTREAM_URL });
}

module.exports = { forward, proxy };