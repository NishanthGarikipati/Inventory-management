import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { authenticate, requirePermission, scopeOf } from '../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { notFound } from '../../domain/errors.js';
import { resolveFeatures, templateByCode } from '../../domain/businessTypes.js';

export const businessRouter: Router = Router();

businessRouter.use(authenticate);

businessRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const business = await prisma.business.findUnique({
      where: { id: scope.businessId },
      include: { settings: true },
    });
    if (!business) throw notFound('Business');
    const template = templateByCode(business.businessType);
    res.json({
      business,
      features: resolveFeatures(business.businessType, business.settings?.featureOverrides),
      template: template
        ? { name: template.name, icon: template.icon, dashboardHighlights: template.dashboardHighlights }
        : null,
    });
  }),
);

businessRouter.patch(
  '/',
  requirePermission('settings:write'),
  validateBody(
    z.object({
      name: z.string().min(2).optional(),
      ownerName: z.string().min(2).optional(),
      phone: z.string().min(10).max(15).optional(),
      email: z.string().email().nullable().optional(),
      address: z.string().max(400).nullable().optional(),
      gstin: z.string().max(20).nullable().optional(),
      logoRef: z.string().nullable().optional(),
      currency: z.string().length(3).optional(),
      country: z.string().length(2).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const business = await prisma.business.update({ where: { id: scope.businessId }, data: req.body });
    res.json({ business });
  }),
);

businessRouter.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const settings = await prisma.businessSettings.findUnique({
      where: { businessId: scopeOf(req).businessId },
    });
    if (!settings) throw notFound('Settings');
    res.json({ settings, featureOverrides: JSON.parse(settings.featureOverrides) });
  }),
);

businessRouter.patch(
  '/settings',
  requirePermission('settings:write'),
  validateBody(
    z.object({
      taxEnabled: z.boolean().optional(),
      pricesIncludeTax: z.boolean().optional(),
      defaultTaxRate: z.number().min(0).max(100).optional(),
      taxLabel: z.string().max(20).optional(),
      allowNegativeStock: z.boolean().optional(),
      roundOffSaleTotal: z.boolean().optional(),
      lowStockAlerts: z.boolean().optional(),
      expiryAlertDays: z.number().int().min(1).max(365).optional(),
      confidenceHigh: z.number().min(0).max(1).optional(),
      confidenceMedium: z.number().min(0).max(1).optional(),
      invoicePrefix: z.string().max(10).optional(),
      featureOverrides: z.record(z.boolean()).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const { featureOverrides, ...rest } = req.body;
    const settings = await prisma.businessSettings.update({
      where: { businessId: scope.businessId },
      data: {
        ...rest,
        ...(featureOverrides ? { featureOverrides: JSON.stringify(featureOverrides) } : {}),
      },
    });
    res.json({ settings });
  }),
);

businessRouter.get(
  '/taxes',
  asyncHandler(async (req, res) => {
    res.json({
      taxes: await prisma.tax.findMany({ where: { businessId: scopeOf(req).businessId }, orderBy: { rate: 'asc' } }),
    });
  }),
);

businessRouter.post(
  '/taxes',
  requirePermission('settings:write'),
  validateBody(z.object({ name: z.string().min(1), rate: z.number().min(0).max(100), isDefault: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    if (req.body.isDefault) {
      await prisma.tax.updateMany({ where: { businessId: scope.businessId }, data: { isDefault: false } });
    }
    res.status(201).json(
      await prisma.tax.create({
        data: { businessId: scope.businessId, name: req.body.name, rate: req.body.rate, isDefault: req.body.isDefault ?? false },
      }),
    );
  }),
);

businessRouter.get(
  '/categories',
  asyncHandler(async (req, res) => {
    res.json({
      categories: await prisma.category.findMany({
        where: { businessId: scopeOf(req).businessId },
        orderBy: { name: 'asc' },
      }),
    });
  }),
);

businessRouter.post(
  '/categories',
  requirePermission('product:write'),
  validateBody(z.object({ name: z.string().min(1), parentId: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    res.status(201).json(
      await prisma.category.create({
        data: { businessId: scope.businessId, name: req.body.name, parentId: req.body.parentId ?? null },
      }),
    );
  }),
);

businessRouter.get(
  '/brands',
  asyncHandler(async (req, res) => {
    res.json({
      brands: await prisma.brand.findMany({ where: { businessId: scopeOf(req).businessId }, orderBy: { name: 'asc' } }),
    });
  }),
);

businessRouter.post(
  '/brands',
  requirePermission('product:write'),
  validateBody(z.object({ name: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    res.status(201).json(await prisma.brand.create({ data: { businessId: scope.businessId, name: req.body.name } }));
  }),
);

businessRouter.get(
  '/units',
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const [units, conversions] = await Promise.all([
      prisma.unit.findMany({ where: { businessId: scope.businessId }, orderBy: { code: 'asc' } }),
      prisma.unitConversion.findMany({
        where: { businessId: scope.businessId },
        include: { fromUnit: true, toUnit: true },
      }),
    ]);
    res.json({
      units,
      conversions: conversions.map((c) => ({
        id: c.id,
        from: c.fromUnit.code,
        to: c.toUnit.code,
        factor: c.factor,
        productId: c.productId,
        label: `1 ${c.fromUnit.name} = ${c.factor} ${c.toUnit.name}`,
      })),
    });
  }),
);

businessRouter.post(
  '/units',
  requirePermission('settings:write'),
  validateBody(z.object({ code: z.string().min(1).max(10), name: z.string().min(1), allowDecimal: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    res.status(201).json(
      await prisma.unit.create({
        data: {
          businessId: scope.businessId,
          code: req.body.code.toUpperCase(),
          name: req.body.name,
          allowDecimal: req.body.allowDecimal ?? false,
        },
      }),
    );
  }),
);

businessRouter.post(
  '/unit-conversions',
  requirePermission('settings:write'),
  validateBody(
    z.object({
      fromUnitId: z.string(),
      toUnitId: z.string(),
      factor: z.number().positive(),
      productId: z.string().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    res.status(201).json(
      await prisma.unitConversion.create({
        data: {
          businessId: scope.businessId,
          fromUnitId: req.body.fromUnitId,
          toUnitId: req.body.toUnitId,
          factor: req.body.factor,
          productId: req.body.productId ?? null,
        },
      }),
    );
  }),
);

businessRouter.get(
  '/attributes',
  asyncHandler(async (req, res) => {
    const definitions = await prisma.productAttributeDefinition.findMany({
      where: { businessId: scopeOf(req).businessId },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({
      attributes: definitions.map((definition) => ({
        ...definition,
        options: JSON.parse(definition.options) as string[],
      })),
    });
  }),
);

businessRouter.post(
  '/attributes',
  requirePermission('settings:write'),
  validateBody(
    z.object({
      key: z.string().min(1).max(40),
      label: z.string().min(1).max(60),
      dataType: z.enum(['TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN']),
      options: z.array(z.string()).optional(),
      isRequired: z.boolean().optional(),
      showInList: z.boolean().optional(),
      appliesToVariant: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    res.status(201).json(
      await prisma.productAttributeDefinition.create({
        data: {
          businessId: scope.businessId,
          key: req.body.key,
          label: req.body.label,
          dataType: req.body.dataType,
          options: JSON.stringify(req.body.options ?? []),
          isRequired: req.body.isRequired ?? false,
          showInList: req.body.showInList ?? false,
          appliesToVariant: req.body.appliesToVariant ?? false,
        },
      }),
    );
  }),
);
