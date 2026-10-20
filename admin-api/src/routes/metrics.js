'use strict';

const express = require('express');
const { z } = require('zod');
const { prisma } = require('../config/prisma');
const { validate } = require('../validation/schemas');

const router = express.Router();

const summaryQuerySchema = z.object({
  tenant_id: z.string().uuid().optional(),
  hours: z.coerce.number().int().min(1).max(24 * 30).default(24),
});

router.get('/summary', validate(summaryQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { tenant_id: tenantId, hours } = req.validatedQuery;
    const since = new Date(Date.now() - hours * 3600 * 1000);

    const where = { createdAt: { gte: since } };
    if (tenantId) where.tenantId = tenantId;

    const grouped = await prisma.usageLog.groupBy({
      by: ['tenantId', 'allowed'],
      where,
      _count: { _all: true }, // never select `id` — BigInt breaks JSON.stringify
    });

    const byTenant = new Map();
    for (const row of grouped) {
      const entry = byTenant.get(row.tenantId) || { allowed: 0, denied: 0 };
      if (row.allowed) entry.allowed += row._count._all;
      else entry.denied += row._count._all;
      byTenant.set(row.tenantId, entry);
    }

    const tenants = await prisma.tenant.findMany({
      where: { id: { in: [...byTenant.keys()] } },
      select: { id: true, name: true, plan: true },
    });
    const names = new Map(tenants.map((t) => [t.id, t]));

    const data = [...byTenant.entries()].map(([id, counts]) => {
      const total = counts.allowed + counts.denied;
      return {
        tenant_id: id,
        name: names.get(id)?.name ?? null,
        plan: names.get(id)?.plan ?? null,
        allowed: counts.allowed,
        denied: counts.denied,
        total,
        deny_rate: total === 0 ? 0 : Number((counts.denied / total).toFixed(4)),
      };
    });

    data.sort((a, b) => b.total - a.total);

    return res.status(200).json({
      window_hours: hours,
      since: since.toISOString(),
      // usage_logs is written async and may be sampled (frozen F8): directional, not a ledger.
      sampled: true,
      data,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = { router };