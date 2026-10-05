import { Router } from 'express';
import type { Request } from 'express';
import { asyncHandler } from '../middleware/validate.js';
import { authenticate, requirePermission, scopeOf } from '../middleware/auth.js';
import {
  expenseReport,
  getDashboard,
  inventoryReport,
  outstandingReport,
  paymentSummary,
  profitReport,
  purchaseReport,
  salesByCategory,
  salesReport,
  scanHistoryReport,
  stockMovementReport,
  topSellingProducts,
  type RangeInput,
} from '../../services/report.service.js';
import type { DatePreset } from '../../utils/dates.js';

export const reportRouter: Router = Router();
export const dashboardRouter: Router = Router();

dashboardRouter.use(authenticate);
reportRouter.use(authenticate);

dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await getDashboard(scopeOf(req)));
  }),
);

const rangeOf = (req: Request): RangeInput => ({
  preset: (req.query.preset as DatePreset) ?? 'TODAY',
  from: typeof req.query.from === 'string' ? req.query.from : undefined,
  to: typeof req.query.to === 'string' ? req.query.to : undefined,
});

reportRouter.use(requirePermission('report:read'));

reportRouter.get(
  '/sales',
  asyncHandler(async (req, res) => {
    res.json(await salesReport(scopeOf(req), rangeOf(req)));
  }),
);

reportRouter.get(
  '/sales/products',
  asyncHandler(async (req, res) => {
    res.json({ products: await topSellingProducts(scopeOf(req), rangeOf(req), Number(req.query.limit ?? 20)) });
  }),
);

reportRouter.get(
  '/sales/categories',
  asyncHandler(async (req, res) => {
    res.json({ categories: await salesByCategory(scopeOf(req), rangeOf(req)) });
  }),
);

reportRouter.get(
  '/purchases',
  asyncHandler(async (req, res) => {
    res.json(await purchaseReport(scopeOf(req), rangeOf(req)));
  }),
);

reportRouter.get(
  '/inventory',
  asyncHandler(async (req, res) => {
    res.json(await inventoryReport(scopeOf(req)));
  }),
);

reportRouter.get(
  '/outstanding',
  asyncHandler(async (req, res) => {
    res.json(await outstandingReport(scopeOf(req)));
  }),
);

reportRouter.get(
  '/profit',
  asyncHandler(async (req, res) => {
    res.json(await profitReport(scopeOf(req), rangeOf(req)));
  }),
);

reportRouter.get(
  '/expenses',
  asyncHandler(async (req, res) => {
    res.json(await expenseReport(scopeOf(req), rangeOf(req)));
  }),
);

reportRouter.get(
  '/payments',
  asyncHandler(async (req, res) => {
    res.json(await paymentSummary(scopeOf(req), rangeOf(req)));
  }),
);

reportRouter.get(
  '/stock-movement',
  asyncHandler(async (req, res) => {
    res.json(
      await stockMovementReport(
        scopeOf(req),
        rangeOf(req),
        typeof req.query.variantId === 'string' ? req.query.variantId : undefined,
      ),
    );
  }),
);

reportRouter.get(
  '/scans',
  asyncHandler(async (req, res) => {
    res.json(await scanHistoryReport(scopeOf(req), rangeOf(req)));
  }),
);
