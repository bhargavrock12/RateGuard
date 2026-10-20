'use strict';

const { z } = require('zod');
const { AppError, ERROR_CODES } = require('../utils/errors');

const ALGORITHMS = [
  'fixed_window',
  'sliding_window_counter',
  'sliding_window_log',
  'token_bucket',
  'leaky_bucket',
];

const WINDOW_ALGORITHMS = new Set([
  'fixed_window',
  'sliding_window_counter',
  'sliding_window_log',
]);
const BUCKET_ALGORITHMS = new Set(['token_bucket', 'leaky_bucket']);

const loginSchema = z
  .object({
    username: z.string().min(1),
    password: z.string().min(1),
  })
  .strict();

const createTenantSchema = z
  .object({
    name: z.string().min(1).max(200),
    plan: z.string().min(1).max(50).default('free'),
  })
  .strict();

const updateTenantSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    plan: z.string().min(1).max(50).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

/** Conditional rules SQL cannot express. */
function applyAlgorithmRules(value, ctx) {
  const { algorithm, window_seconds: windowSeconds, refill_rate: refillRate } = value;
  if (!algorithm) return;

  if (WINDOW_ALGORITHMS.has(algorithm)) {
    if (windowSeconds === undefined || windowSeconds === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['window_seconds'],
        message: `window_seconds is required for ${algorithm}`,
      });
    }
  }

  if (BUCKET_ALGORITHMS.has(algorithm)) {
    if (refillRate === undefined || refillRate === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['refill_rate'],
        message: `refill_rate is required for ${algorithm}`,
      });
    }
  }
}

const policyBase = {
  tenant_id: z.string().uuid(),
  route_pattern: z.string().min(1).max(500).startsWith('/', 'route_pattern must start with /'),
  algorithm: z.enum(ALGORITHMS),
  limit_count: z.coerce.number().int().positive(),
  window_seconds: z.coerce.number().int().positive().optional(),
  refill_rate: z.coerce.number().nonnegative().optional(),
};

const createPolicySchema = z.object(policyBase).strict().superRefine(applyAlgorithmRules);

const updatePolicySchema = z
  .object({
    route_pattern: policyBase.route_pattern.optional(),
    algorithm: policyBase.algorithm.optional(),
    limit_count: policyBase.limit_count.optional(),
    window_seconds: policyBase.window_seconds,
    refill_rate: policyBase.refill_rate,
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' })
  .superRefine(applyAlgorithmRules);

const listPoliciesQuerySchema = z
  .object({ tenant_id: z.string().uuid().optional() })
  .strict();

const idParamSchema = z.object({ id: z.string().uuid('id must be a UUID') });

/** Middleware factory: validates and replaces req[source] with parsed data. */
function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.') || source,
        message: i.message,
      }));
      return next(
        new AppError(ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', 400, details)
      );
    }
    if (source === 'query') req.validatedQuery = result.data;
    else req[source] = result.data;
    return next();
  };
}

module.exports = {
  ALGORITHMS,
  WINDOW_ALGORITHMS,
  BUCKET_ALGORITHMS,
  loginSchema,
  createTenantSchema,
  updateTenantSchema,
  createPolicySchema,
  updatePolicySchema,
  listPoliciesQuerySchema,
  idParamSchema,
  validate,
};