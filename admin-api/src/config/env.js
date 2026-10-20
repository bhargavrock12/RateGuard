'use strict';

const { z } = require('zod');

const isProd = process.env.NODE_ENV === 'production';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  NODE_ID: z.string().default('admin-api'),
  PORT: z.coerce.number().int().positive().default(4001),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  // MUST be byte-identical to the Gateway's API_KEY_PEPPER.
  API_KEY_PEPPER: z.string().min(1, 'API_KEY_PEPPER is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('30m'),
  JWT_ISSUER: z.string().default('rateguard-admin'),
  JWT_AUDIENCE: z.string().default('rateguard-admin-api'),

  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD_HASH: z.string().min(1, 'ADMIN_PASSWORD_HASH is required'),

  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  LOGIN_WINDOW_MS: z.coerce.number().int().positive().default(60000),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const message = `Invalid environment configuration:\n  - ${issues.join('\n  - ')}`;
  if (isProd) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
  process.stderr.write(`[warn] ${message}\n`);
}

module.exports = Object.freeze(parsed.success ? parsed.data : { ...process.env });