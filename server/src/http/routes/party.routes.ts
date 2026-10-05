import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { authenticate, requirePermission, scopeOf } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import {
  createCustomer,
  createSupplier,
  getCustomerDetail,
  getSupplierDetail,
  listCustomers,
  listSuppliers,
  recordCustomerPayment,
  recordSupplierPayment,
  updateCustomer,
  updateSupplier,
} from '../../services/party.service.js';
import { PAYMENT_METHODS } from '../../domain/enums.js';

export const customerRouter: Router = Router();
export const supplierRouter: Router = Router();
export const paymentRouter: Router = Router();

const partySchema = z.object({
  name: z.string().min(1, 'Please enter a name'),
  phone: z.string().max(15).nullable().optional(),
  email: z.string().email().nullable().optional(),
  address: z.string().max(400).nullable().optional(),
  gstin: z.string().max(20).nullable().optional(),
  creditLimitPaise: z.number().int().min(0).optional(),
  openingBalancePaise: z.number().int().optional(),
});

customerRouter.use(authenticate);
supplierRouter.use(authenticate);
paymentRouter.use(authenticate);

customerRouter.get(
  '/',
  requirePermission('customer:read'),
  asyncHandler(async (req, res) => {
    const { search, withDueOnly, page, pageSize } = req.query;
    res.json(
      await listCustomers(scopeOf(req), {
        search: typeof search === 'string' ? search : undefined,
        withDueOnly: withDueOnly === 'true',
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      }),
    );
  }),
);

customerRouter.post(
  '/',
  requirePermission('customer:write'),
  validateBody(partySchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createCustomer(scopeOf(req), req.body));
  }),
);

customerRouter.get(
  '/:id',
  requirePermission('customer:read'),
  asyncHandler(async (req, res) => {
    res.json(await getCustomerDetail(scopeOf(req), req.params.id));
  }),
);

customerRouter.put(
  '/:id',
  requirePermission('customer:write'),
  validateBody(partySchema.partial()),
  asyncHandler(async (req, res) => {
    res.json(await updateCustomer(scopeOf(req), req.params.id, req.body));
  }),
);

supplierRouter.get(
  '/',
  requirePermission('supplier:read'),
  asyncHandler(async (req, res) => {
    const { search, withDueOnly, page, pageSize } = req.query;
    res.json(
      await listSuppliers(scopeOf(req), {
        search: typeof search === 'string' ? search : undefined,
        withDueOnly: withDueOnly === 'true',
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      }),
    );
  }),
);

supplierRouter.post(
  '/',
  requirePermission('supplier:write'),
  validateBody(partySchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createSupplier(scopeOf(req), req.body));
  }),
);

supplierRouter.get(
  '/:id',
  requirePermission('supplier:read'),
  asyncHandler(async (req, res) => {
    res.json(await getSupplierDetail(scopeOf(req), req.params.id));
  }),
);

supplierRouter.put(
  '/:id',
  requirePermission('supplier:write'),
  validateBody(partySchema.partial()),
  asyncHandler(async (req, res) => {
    res.json(await updateSupplier(scopeOf(req), req.params.id, req.body));
  }),
);

const paymentSchema = z.object({
  amountPaise: z.number().int().positive('Enter an amount more than zero'),
  method: z.enum(PAYMENT_METHODS).optional(),
  reference: z.string().max(60).optional(),
  note: z.string().max(200).optional(),
  clientRequestId: z.string().max(80).optional(),
});

paymentRouter.post(
  '/customer',
  requirePermission('payment:create'),
  idempotent('payments.customer'),
  validateBody(paymentSchema.extend({ customerId: z.string(), saleId: z.string().optional() })),
  asyncHandler(async (req, res) => {
    res.status(201).json(await recordCustomerPayment(scopeOf(req), req.body));
  }),
);

paymentRouter.post(
  '/supplier',
  requirePermission('payment:create'),
  idempotent('payments.supplier'),
  validateBody(paymentSchema.extend({ supplierId: z.string(), purchaseId: z.string().optional() })),
  asyncHandler(async (req, res) => {
    res.status(201).json(await recordSupplierPayment(scopeOf(req), req.body));
  }),
);
