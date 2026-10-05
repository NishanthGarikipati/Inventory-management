import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { authenticate, requirePermission, scopeOf } from '../middleware/auth.js';
import {
  addVariant,
  createProduct,
  findByBarcode,
  generateBarcode,
  getProductDetail,
  listProducts,
  updateProduct,
} from '../../services/product.service.js';
import { matchProduct } from '../../services/matching.service.js';
import { prisma } from '../../db/prisma.js';

export const productRouter: Router = Router();

productRouter.use(authenticate);

const variantSchema = z.object({
  name: z.string().optional(),
  sku: z.string().optional(),
  barcode: z.string().nullable().optional(),
  options: z.record(z.string()).optional(),
  purchasePricePaise: z.number().int().min(0).optional(),
  sellingPricePaise: z.number().int().min(0).optional(),
  mrpPaise: z.number().int().min(0).optional(),
  minStock: z.number().min(0).optional(),
  openingStock: z.number().min(0).optional(),
});

const productSchema = z.object({
  name: z.string().min(1, 'Please enter a product name'),
  description: z.string().max(500).optional(),
  categoryId: z.string().nullable().optional(),
  categoryName: z.string().nullable().optional(),
  brandId: z.string().nullable().optional(),
  brandName: z.string().nullable().optional(),
  unitId: z.string().nullable().optional(),
  unitCode: z.string().nullable().optional(),
  taxId: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  imageRef: z.string().nullable().optional(),
  trackBatch: z.boolean().optional(),
  trackExpiry: z.boolean().optional(),
  trackSerial: z.boolean().optional(),
  isComposite: z.boolean().optional(),
  isService: z.boolean().optional(),
  attributes: z.record(z.string()).optional(),
  variants: z.array(variantSchema).optional(),
  sku: z.string().optional(),
  barcode: z.string().nullable().optional(),
  purchasePricePaise: z.number().int().min(0).optional(),
  sellingPricePaise: z.number().int().min(0).optional(),
  mrpPaise: z.number().int().min(0).optional(),
  minStock: z.number().min(0).optional(),
  openingStock: z.number().min(0).optional(),
  ignoreDuplicateWarning: z.boolean().optional(),
});

productRouter.get(
  '/',
  requirePermission('product:read'),
  asyncHandler(async (req, res) => {
    const { search, categoryId, brandId, page, pageSize, includeInactive } = req.query;
    res.json(
      await listProducts(scopeOf(req), {
        search: typeof search === 'string' ? search : undefined,
        categoryId: typeof categoryId === 'string' ? categoryId : undefined,
        brandId: typeof brandId === 'string' ? brandId : undefined,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
        includeInactive: includeInactive === 'true',
      }),
    );
  }),
);

productRouter.get(
  '/barcode/:code',
  requirePermission('product:read'),
  asyncHandler(async (req, res) => {
    const product = await findByBarcode(scopeOf(req), req.params.code);
    if (!product) {
      res.status(404).json({
        error: {
          code: 'PRODUCT_NOT_FOUND',
          message: 'This barcode is not in your shop yet.',
          actions: [
            { label: 'Create Product', action: 'CREATE_PRODUCT', payload: { barcode: req.params.code } },
            { label: 'Search Product', action: 'SEARCH_PRODUCT' },
          ],
        },
      });
      return;
    }
    res.json({ product });
  }),
);

productRouter.post(
  '/match',
  requirePermission('product:read'),
  validateBody(
    z.object({
      name: z.string().optional(),
      barcode: z.string().optional(),
      sku: z.string().optional(),
      brand: z.string().optional(),
      size: z.string().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(await matchProduct(prisma, scopeOf(req).businessId, req.body));
  }),
);

productRouter.get(
  '/:id',
  requirePermission('product:read'),
  asyncHandler(async (req, res) => {
    res.json(await getProductDetail(prisma, scopeOf(req), req.params.id));
  }),
);

productRouter.post(
  '/',
  requirePermission('product:write'),
  validateBody(productSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createProduct(scopeOf(req), req.body));
  }),
);

productRouter.put(
  '/:id',
  requirePermission('product:write'),
  validateBody(productSchema.partial().extend({ isActive: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    res.json(await updateProduct(scopeOf(req), req.params.id, req.body));
  }),
);

productRouter.post(
  '/:id/variants',
  requirePermission('product:write'),
  validateBody(variantSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await addVariant(scopeOf(req), req.params.id, req.body));
  }),
);

productRouter.post(
  '/variants/:variantId/barcode',
  requirePermission('product:write'),
  asyncHandler(async (req, res) => {
    res.json(await generateBarcode(scopeOf(req), req.params.variantId));
  }),
);

productRouter.delete(
  '/:id',
  requirePermission('product:delete'),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    // Products are never hard deleted: their history has to stay readable.
    const result = await prisma.product.updateMany({
      where: { id: req.params.id, businessId: scope.businessId },
      data: { isActive: false },
    });
    res.json({ deactivated: result.count });
  }),
);
