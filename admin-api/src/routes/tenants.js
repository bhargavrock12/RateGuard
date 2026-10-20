'use strict';

const express = require('express');
const { prisma } = require('../config/prisma');
const { publishInvalidate } = require('../config/redis');
const { generateApiKey, hashApiKey, apiKeyPrefix } = require('../utils/hash');
const { AppError, ERROR_CODES } = require('../utils/errors');
const {
  createTenantSchema,
  updateTenantSchema,
  idParamSchema,
  validate,
} = require('../validation/schemas');

const router = express.Router();

/** The only place tenant data is shaped for output. api_key_hash never appears. */
function serializeTenant(tenant) {
  return {
    id: tenant.id,
    name: tenant.name,
    plan: tenant.plan,
    api_key_prefix: tenant.apiKeyPrefix,
    created_at: tenant.createdAt,
  };
}

router.post('/', validate(createTenantSchema), async (req, res, next) => {
  try {
    const rawKey = generateApiKey();
    const tenant = await prisma.tenant.create({
      data: {
        name: req.body.name,
        plan: req.body.plan,
        apiKeyHash: hashApiKey(rawKey),
        apiKeyPrefix: apiKeyPrefix(rawKey),
      },
    });

    await publishInvalidate(tenant.id);

    // The raw key is shown exactly once, here.
    return res.status(201).json({ ...serializeTenant(tenant), api_key: rawKey });
  } catch (err) {
    return next(err);
  }
});

router.get('/', async (_req, res, next) => {
  try {
    const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } });
    return res.status(200).json({ data: tenants.map(serializeTenant) });
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', validate(idParamSchema, 'params'), async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) throw new AppError(ERROR_CODES.NOT_FOUND, 'Tenant not found', 404);
    return res.status(200).json(serializeTenant(tenant));
  } catch (err) {
    return next(err);
  }
});

router.put(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateTenantSchema),
  async (req, res, next) => {
    try {
      const tenant = await prisma.tenant.update({
        where: { id: req.params.id },
        data: { name: req.body.name, plan: req.body.plan },
      });
      await publishInvalidate(tenant.id);
      return res.status(200).json(serializeTenant(tenant));
    } catch (err) {
      return next(err);
    }
  }
);

router.delete('/:id', validate(idParamSchema, 'params'), async (req, res, next) => {
  try {
    await prisma.tenant.delete({ where: { id: req.params.id } }); // cascades policies
    await publishInvalidate(req.params.id);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/rotate-key', validate(idParamSchema, 'params'), async (req, res, next) => {
  try {
    const rawKey = generateApiKey();
    const tenant = await prisma.tenant.update({
      where: { id: req.params.id },
      data: { apiKeyHash: hashApiKey(rawKey), apiKeyPrefix: apiKeyPrefix(rawKey) },
    });

    // Without this the gateway keeps honouring the old key until the cache TTL expires.
    await publishInvalidate(tenant.id);

    return res.status(200).json({ ...serializeTenant(tenant), api_key: rawKey });
  } catch (err) {
    return next(err);
  }
});

module.exports = { router, serializeTenant };