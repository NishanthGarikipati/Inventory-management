import { Router } from 'express';
import { asyncHandler } from '../middleware/validate.js';
import { authenticate, scopeOf } from '../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { normalizeName } from '../../utils/text.js';
import { roundQty } from '../../domain/money.js';

export const searchRouter: Router = Router();

searchRouter.use(authenticate);

/** One search box for products, people and bills. */
searchRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const query = String(req.query.q ?? '').trim();
    if (query.length < 1) {
      res.json({ products: [], customers: [], suppliers: [], sales: [] });
      return;
    }
    const normalized = normalizeName(query);

    const [variants, customers, suppliers, sales] = await Promise.all([
      prisma.productVariant.findMany({
        where: {
          businessId: scope.businessId,
          isActive: true,
          OR: [
            { barcode: query },
            { sku: { contains: query } },
            { product: { name: { contains: query } } },
            { product: { normalizedName: { contains: normalized } } },
          ],
        },
        include: { product: { include: { unit: true, tax: true } }, inventory: true },
        take: 20,
      }),
      prisma.customer.findMany({
        where: {
          businessId: scope.businessId,
          isActive: true,
          OR: [{ name: { contains: query } }, { phone: { contains: query } }],
        },
        take: 10,
      }),
      prisma.supplier.findMany({
        where: {
          businessId: scope.businessId,
          isActive: true,
          OR: [{ name: { contains: query } }, { phone: { contains: query } }],
        },
        take: 10,
      }),
      prisma.sale.findMany({
        where: { businessId: scope.businessId, invoiceNumber: { contains: query } },
        select: { id: true, invoiceNumber: true, totalPaise: true, saleDate: true },
        take: 10,
      }),
    ]);

    res.json({
      products: variants.map((variant) => ({
        variantId: variant.id,
        productId: variant.productId,
        name: variant.isDefault ? variant.product.name : `${variant.product.name} - ${variant.name}`,
        sku: variant.sku,
        barcode: variant.barcode,
        unit: variant.product.unit.code,
        allowDecimal: variant.product.unit.allowDecimal,
        taxRate: variant.product.tax?.rate ?? 0,
        sellingPricePaise: variant.sellingPricePaise,
        mrpPaise: variant.mrpPaise,
        stock: roundQty(variant.inventory?.quantity ?? 0),
        trackBatch: variant.product.trackBatch,
        trackSerial: variant.product.trackSerial,
      })),
      customers,
      suppliers,
      sales,
    });
  }),
);
