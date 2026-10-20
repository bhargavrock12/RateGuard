'use strict';

const express = require('express');
const { prisma } = require('../config/prisma');
const { publishInvalidate } = require('../config/redis');
const { AppError, ERROR_CODES } = require('../utils/errors');
const {
  createPolicySchema,
  updatePolicySchema,
  listPoliciesQuerySchema,
  idParamSchema,
  validate,
} = require('../validation/schemas');

const router = express.Router();

/** Shape matches what the gateway reads from Postgres. */
function serializePolicy(policy) {
  return {
    id: policy.id,
    tenant_id: policy.tenantId,
    route_pattern: policy.routePattern,
    algorithm: policy.algorithm,
    limit_count: policy.limitCount,
    window_seconds: policy.windowSeconds,
    refill_rate: policy.refillRate === null ? null : Number(policy.refillRate),
    created_at: policy.createdAt,
    updated_at: policy.updatedAt,
  };
}

router.post('/', validate(createPolicySchema), async (req, res, next) => {
  try {
    const body = req.body;
    const policy = await prisma.rateLimitPolicy.create({
      data: {
        tenantId: body.tenant_id,
        routePattern: body.route_pattern,
        algorithm: body.algorithm,
        limitCount: body.limit_count,
        windowSeconds: body.window_seconds ?? null,
        refillRate: body.refill_rate ?? null,
      },
    });

    await publishInvalidate(policy.tenantId);
    return res.status(201).json(serializePolicy(policy));
  } catch (err) {
    return next(err);
  }
});

router.get('/', validate(listPoliciesQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { tenant_id: tenantId } = req.validatedQuery;
    const policies = await prisma.rateLimitPolicy.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return res.status(200).json({ data: policies.map(serializePolicy) });
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', validate(idParamSchema, 'params'), async (req, res, next) => {
  try {
    const policy = await prisma.rateLimitPolicy.findUnique({ where: { id: req.params.id } });
    if (!policy) throw new AppError(ERROR_CODES.NOT_FOUND, 'Policy not found', 404);
    return res.status(200).json(serializePolicy(policy));
  } catch (err) {
    return next(err);
  }
});

router.put(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updatePolicySchema),
  async (req, res, next) => {
    try {
      const body = req.body;
      const data = {};
      if (body.route_pattern !== undefined) data.routePattern = body.route_pattern;
      if (body.algorithm !== undefined) data.algorithm = body.algorithm;
      if (body.limit_count !== undefined) data.limitCount = body.limit_count;
      if (body.window_seconds !== undefined) data.windowSeconds = body.window_seconds;
      if (body.refill_rate !== undefined) data.refillRate = body.refill_rate;

      const policy = await prisma.rateLimitPolicy.update({ where: { id: req.params.id }, data });

      // Tenant id comes from the stored row, never from caller input.
      await publishInvalidate(policy.tenantId);
      return res.status(200).json(serializePolicy(policy));
    } catch (err) {
      return next(err);
    }
  }
);

router.delete('/:id', validate(idParamSchema, 'params'), async (req, res, next) => {
  try {
    const policy = await prisma.rateLimitPolicy.delete({ where: { id: req.params.id } });
    await publishInvalidate(policy.tenantId);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = { router, serializePolicy };