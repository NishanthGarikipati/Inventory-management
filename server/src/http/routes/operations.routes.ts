import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { authenticate, requirePermission, scopeOf } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import { createExpense, deleteExpense, listExpenseCategories, listExpenses } from '../../services/expense.service.js';
import { closeDay, getDaySummary, listClosings } from '../../services/closing.service.js';
import {
  listNotifications,
  markNotificationRead,
  refreshBusinessAlerts,
} from '../../services/notification.service.js';
import { createRecipe, listProductions, listRecipes, listWastage, recordProduction, recordWastage } from '../../services/production.service.js';
import { PAYMENT_METHODS } from '../../domain/enums.js';
import { prisma } from '../../db/prisma.js';

export const expenseRouter: Router = Router();
export const closingRouter: Router = Router();
export const notificationRouter: Router = Router();
export const productionRouter: Router = Router();
export const auditRouter: Router = Router();

for (const router of [expenseRouter, closingRouter, notificationRouter, productionRouter, auditRouter]) {
  router.use(authenticate);
}

expenseRouter.get(
  '/categories',
  requirePermission('expense:read'),
  asyncHandler(async (req, res) => {
    res.json({ categories: await listExpenseCategories(scopeOf(req)) });
  }),
);

expenseRouter.get(
  '/',
  requirePermission('expense:read'),
  asyncHandler(async (req, res) => {
    const { from, to, categoryId, page, pageSize } = req.query;
    res.json(
      await listExpenses(scopeOf(req), {
        from: from ? new Date(String(from)) : undefined,
        to: to ? new Date(String(to)) : undefined,
        categoryId: typeof categoryId === 'string' ? categoryId : undefined,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      }),
    );
  }),
);

expenseRouter.post(
  '/',
  requirePermission('expense:write'),
  idempotent('expenses.create'),
  validateBody(
    z.object({
      categoryId: z.string().nullable().optional(),
      categoryName: z.string().nullable().optional(),
      amountPaise: z.number().int().positive('Enter an amount more than zero'),
      method: z.enum(PAYMENT_METHODS).optional(),
      description: z.string().max(300).optional(),
      expenseDate: z.coerce.date().optional(),
      clientRequestId: z.string().max(80).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createExpense(scopeOf(req), req.body));
  }),
);

expenseRouter.delete(
  '/:id',
  requirePermission('expense:write'),
  asyncHandler(async (req, res) => {
    await deleteExpense(scopeOf(req), req.params.id);
    res.json({ ok: true });
  }),
);

closingRouter.get(
  '/summary',
  requirePermission('report:read'),
  asyncHandler(async (req, res) => {
    const date = req.query.date ? new Date(String(req.query.date)) : new Date();
    res.json(await getDaySummary(scopeOf(req), date));
  }),
);

closingRouter.post(
  '/',
  requirePermission('closing:write'),
  validateBody(
    z.object({
      date: z.coerce.date().optional(),
      actualCashPaise: z.number().int().min(0),
      note: z.string().max(300).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json(await closeDay(scopeOf(req), req.body));
  }),
);

closingRouter.get(
  '/',
  requirePermission('report:read'),
  asyncHandler(async (req, res) => {
    res.json({ closings: await listClosings(scopeOf(req), Number(req.query.limit ?? 30)) });
  }),
);

notificationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    if (req.query.refresh === 'true') await refreshBusinessAlerts(scope.businessId);
    res.json({
      notifications: await listNotifications(scope, {
        unreadOnly: req.query.unreadOnly === 'true',
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      }),
    });
  }),
);

notificationRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    await markNotificationRead(scopeOf(req), req.params.id);
    res.json({ ok: true });
  }),
);

notificationRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const result = await prisma.notification.updateMany({
      where: { businessId: scope.businessId, isRead: false },
      data: { isRead: true },
    });
    res.json({ updated: result.count });
  }),
);

productionRouter.get(
  '/recipes',
  requirePermission('product:read'),
  asyncHandler(async (req, res) => {
    res.json({ recipes: await listRecipes(scopeOf(req)) });
  }),
);

productionRouter.post(
  '/recipes',
  requirePermission('product:write'),
  validateBody(
    z.object({
      productId: z.string(),
      name: z.string().min(1),
      yieldQty: z.number().positive().optional(),
      autoConsumeOnSale: z.boolean().optional(),
      items: z.array(z.object({ variantId: z.string(), quantity: z.number().positive(), note: z.string().optional() })).min(1),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createRecipe(scopeOf(req), req.body));
  }),
);

productionRouter.post(
  '/runs',
  requirePermission('inventory:adjust'),
  idempotent('production.run'),
  validateBody(
    z.object({
      recipeId: z.string(),
      quantity: z.number().positive(),
      batchLabel: z.string().max(40).optional(),
      expiryDate: z.coerce.date().optional(),
      note: z.string().max(300).optional(),
      clientRequestId: z.string().max(80).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json(await recordProduction(scopeOf(req), req.body));
  }),
);

productionRouter.get(
  '/runs',
  requirePermission('inventory:read'),
  asyncHandler(async (req, res) => {
    res.json({ productions: await listProductions(scopeOf(req)) });
  }),
);

productionRouter.post(
  '/wastage',
  requirePermission('inventory:adjust'),
  idempotent('production.wastage'),
  validateBody(
    z.object({
      variantId: z.string(),
      quantity: z.number().positive(),
      reason: z.string().min(2).max(200),
      clientRequestId: z.string().max(80).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json(await recordWastage(scopeOf(req), req.body));
  }),
);

productionRouter.get(
  '/wastage',
  requirePermission('inventory:read'),
  asyncHandler(async (req, res) => {
    res.json({ wastage: await listWastage(scopeOf(req)) });
  }),
);

auditRouter.get(
  '/',
  requirePermission('audit:read'),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const { entityType, entityId, action, limit } = req.query;
    const logs = await prisma.auditLog.findMany({
      where: {
        businessId: scope.businessId,
        ...(typeof entityType === 'string' ? { entityType } : {}),
        ...(typeof entityId === 'string' ? { entityId } : {}),
        ...(typeof action === 'string' ? { action } : {}),
      },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Number(limit ?? 100)),
    });
    res.json({
      logs: logs.map((log) => ({
        ...log,
        before: log.before ? JSON.parse(log.before) : null,
        after: log.after ? JSON.parse(log.after) : null,
        meta: log.meta ? JSON.parse(log.meta) : null,
      })),
    });
  }),
);
