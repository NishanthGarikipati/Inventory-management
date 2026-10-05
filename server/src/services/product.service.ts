import { prisma, txOptions, type Tx } from '../db/prisma.js';
import type { TenantScope } from '../db/tenant.js';
import { badRequest, conflict, notFound } from '../domain/errors.js';
import { roundQty } from '../domain/money.js';
import { normalizeName } from '../utils/text.js';
import { applyStockMovement, getBusinessSettings } from './inventory.service.js';
import { recordAudit } from './audit.service.js';
import { matchProduct, FUZZY_MATCH_STRONG } from './matching.service.js';
import type { TransactionSource } from '../domain/enums.js';

export interface VariantInput {
  name?: string;
  sku?: string;
  barcode?: string | null;
  options?: Record<string, string>;
  purchasePricePaise?: number;
  sellingPricePaise?: number;
  mrpPaise?: number;
  minStock?: number;
  openingStock?: number;
}

export interface CreateProductInput {
  name: string;
  description?: string;
  categoryId?: string | null;
  categoryName?: string | null;
  brandId?: string | null;
  brandName?: string | null;
  unitId?: string | null;
  unitCode?: string | null;
  taxId?: string | null;
  supplierId?: string | null;
  imageRef?: string | null;
  trackBatch?: boolean;
  trackExpiry?: boolean;
  trackSerial?: boolean;
  isComposite?: boolean;
  isService?: boolean;
  attributes?: Record<string, string>;
  variants?: VariantInput[];
  /** Single-variant shorthand used by the quick "Add Product" screen. */
  sku?: string;
  barcode?: string | null;
  purchasePricePaise?: number;
  sellingPricePaise?: number;
  mrpPaise?: number;
  minStock?: number;
  openingStock?: number;
  /** Set after the user answers "this is a different product". */
  ignoreDuplicateWarning?: boolean;
  source?: TransactionSource;
}

export async function createProduct(scope: TenantScope, input: CreateProductInput) {
  const name = input.name.trim();
  if (!name) throw badRequest('Please enter a product name.');

  if (!input.ignoreDuplicateWarning) {
    const duplicate = await matchProduct(prisma, scope.businessId, {
      name,
      barcode: input.barcode ?? input.variants?.[0]?.barcode ?? null,
      sku: input.sku ?? null,
    });
    if (duplicate.best && duplicate.score >= FUZZY_MATCH_STRONG) {
      throw conflict(`"${duplicate.best.name}" already looks like this product.`, [
        { label: 'Use Existing', action: 'USE_EXISTING', payload: { variantId: duplicate.best.variantId } },
        { label: 'Create New', action: 'CREATE_ANYWAY' },
      ]);
    }
  }

  return prisma.$transaction(async (tx) => {
    const unitId = await resolveUnitId(tx, scope.businessId, input.unitId, input.unitCode);
    const categoryId = await resolveCategoryId(tx, scope.businessId, input.categoryId, input.categoryName);
    const brandId = await resolveBrandId(tx, scope.businessId, input.brandId, input.brandName);

    const variantInputs: VariantInput[] = input.variants?.length
      ? input.variants
      : [
          {
            name: 'Default',
            sku: input.sku,
            barcode: input.barcode ?? null,
            purchasePricePaise: input.purchasePricePaise,
            sellingPricePaise: input.sellingPricePaise,
            mrpPaise: input.mrpPaise,
            minStock: input.minStock,
            openingStock: input.openingStock,
          },
        ];

    const product = await tx.product.create({
      data: {
        businessId: scope.businessId,
        name,
        normalizedName: normalizeName(name),
        description: input.description ?? null,
        categoryId,
        brandId,
        unitId,
        taxId: input.taxId ?? (await defaultTaxId(tx, scope.businessId)),
        supplierId: input.supplierId ?? null,
        imageRef: input.imageRef ?? null,
        hasVariants: variantInputs.length > 1,
        trackBatch: input.trackBatch ?? false,
        trackExpiry: input.trackExpiry ?? false,
        trackSerial: input.trackSerial ?? false,
        isComposite: input.isComposite ?? false,
        isService: input.isService ?? false,
      },
    });

    const variants = [];
    for (const [index, variantInput] of variantInputs.entries()) {
      const variant = await createVariantRow(tx, scope, product.id, name, variantInput, {
        isDefault: variantInputs.length === 1,
        index,
      });
      variants.push(variant);
    }

    if (input.attributes) {
      await saveAttributes(tx, scope.businessId, product.id, input.attributes);
    }

    await recordAudit(tx, scope, {
      action: 'PRODUCT_CREATED',
      entityType: 'Product',
      entityId: product.id,
      after: { name, variants: variants.map((v) => ({ sku: v.sku, barcode: v.barcode })) },
      source: input.source ?? 'MANUAL',
    });

    return getProductDetail(tx, scope, product.id);
  }, txOptions);
}

async function createVariantRow(
  tx: Tx,
  scope: TenantScope,
  productId: string,
  productName: string,
  input: VariantInput,
  meta: { isDefault: boolean; index: number },
) {
  const sku = input.sku?.trim() || (await generateSku(tx, scope.businessId, productName, meta.index));
  const variant = await tx.productVariant.create({
    data: {
      businessId: scope.businessId,
      productId,
      name: input.name?.trim() || (meta.isDefault ? 'Default' : `Variant ${meta.index + 1}`),
      sku,
      barcode: input.barcode?.trim() || null,
      options: JSON.stringify(input.options ?? {}),
      purchasePricePaise: input.purchasePricePaise ?? 0,
      sellingPricePaise: input.sellingPricePaise ?? 0,
      mrpPaise: input.mrpPaise ?? input.sellingPricePaise ?? 0,
      minStock: input.minStock ?? 0,
      isDefault: meta.isDefault,
    },
  });

  await tx.inventory.create({
    data: {
      businessId: scope.businessId,
      variantId: variant.id,
      quantity: 0,
      avgCostPaise: input.purchasePricePaise ?? 0,
    },
  });

  if (input.openingStock && input.openingStock > 0) {
    await applyStockMovement(tx, scope, {
      variantId: variant.id,
      quantity: roundQty(input.openingStock),
      type: 'OPENING',
      unitCostPaise: input.purchasePricePaise ?? 0,
      referenceType: 'PRODUCT',
      referenceId: productId,
      note: 'Opening stock',
    });
  }

  return variant;
}

export async function addVariant(scope: TenantScope, productId: string, input: VariantInput) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findFirst({ where: { id: productId, businessId: scope.businessId } });
    if (!product) throw notFound('Product');
    const count = await tx.productVariant.count({ where: { productId } });
    const variant = await createVariantRow(tx, scope, productId, product.name, input, {
      isDefault: false,
      index: count,
    });
    await tx.product.update({ where: { id: productId }, data: { hasVariants: true } });
    return variant;
  }, txOptions);
}

export interface UpdateProductInput extends Partial<Omit<CreateProductInput, 'variants'>> {
  isActive?: boolean;
}

export async function updateProduct(scope: TenantScope, productId: string, input: UpdateProductInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.product.findFirst({
      where: { id: productId, businessId: scope.businessId },
      include: { variants: { where: { isDefault: true }, take: 1 } },
    });
    if (!existing) throw notFound('Product');

    const product = await tx.product.update({
      where: { id: productId },
      data: {
        ...(input.name ? { name: input.name.trim(), normalizedName: normalizeName(input.name) } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.brandId !== undefined ? { brandId: input.brandId } : {}),
        ...(input.unitId ? { unitId: input.unitId } : {}),
        ...(input.taxId !== undefined ? { taxId: input.taxId } : {}),
        ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
        ...(input.imageRef !== undefined ? { imageRef: input.imageRef } : {}),
        ...(input.trackBatch !== undefined ? { trackBatch: input.trackBatch } : {}),
        ...(input.trackExpiry !== undefined ? { trackExpiry: input.trackExpiry } : {}),
        ...(input.trackSerial !== undefined ? { trackSerial: input.trackSerial } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    const defaultVariant = existing.variants[0];
    if (
      defaultVariant &&
      (input.purchasePricePaise !== undefined ||
        input.sellingPricePaise !== undefined ||
        input.mrpPaise !== undefined ||
        input.minStock !== undefined ||
        input.barcode !== undefined)
    ) {
      const updated = await tx.productVariant.update({
        where: { id: defaultVariant.id },
        data: {
          ...(input.purchasePricePaise !== undefined ? { purchasePricePaise: input.purchasePricePaise } : {}),
          ...(input.sellingPricePaise !== undefined ? { sellingPricePaise: input.sellingPricePaise } : {}),
          ...(input.mrpPaise !== undefined ? { mrpPaise: input.mrpPaise } : {}),
          ...(input.minStock !== undefined ? { minStock: input.minStock } : {}),
          ...(input.barcode !== undefined ? { barcode: input.barcode || null } : {}),
        },
      });

      const priceChanged =
        updated.sellingPricePaise !== defaultVariant.sellingPricePaise ||
        updated.purchasePricePaise !== defaultVariant.purchasePricePaise;
      if (priceChanged) {
        await recordAudit(tx, scope, {
          action: 'PRODUCT_PRICE_CHANGE',
          entityType: 'ProductVariant',
          entityId: defaultVariant.id,
          before: {
            purchasePricePaise: defaultVariant.purchasePricePaise,
            sellingPricePaise: defaultVariant.sellingPricePaise,
          },
          after: {
            purchasePricePaise: updated.purchasePricePaise,
            sellingPricePaise: updated.sellingPricePaise,
          },
        });
      }
    }

    if (input.attributes) await saveAttributes(tx, scope.businessId, productId, input.attributes);

    await recordAudit(tx, scope, {
      action: 'PRODUCT_UPDATED',
      entityType: 'Product',
      entityId: product.id,
      before: { name: existing.name },
      after: { name: product.name },
      source: input.source ?? 'MANUAL',
    });

    return getProductDetail(tx, scope, productId);
  }, txOptions);
}

export async function saveAttributes(
  tx: Tx,
  businessId: string,
  productId: string,
  attributes: Record<string, string>,
) {
  const definitions = await tx.productAttributeDefinition.findMany({ where: { businessId } });
  const byKey = new Map(definitions.map((d) => [d.key, d]));
  for (const [key, value] of Object.entries(attributes)) {
    const definition = byKey.get(key);
    if (!definition) continue;
    await tx.productAttributeValue.upsert({
      where: { productId_definitionId: { productId, definitionId: definition.id } },
      create: { businessId, productId, definitionId: definition.id, value: String(value) },
      update: { value: String(value) },
    });
  }
}

export async function getProductDetail(db: Tx | typeof prisma, scope: TenantScope, productId: string) {
  const product = await db.product.findFirst({
    where: { id: productId, businessId: scope.businessId },
    include: {
      category: true,
      brand: true,
      unit: true,
      tax: true,
      supplier: { select: { id: true, name: true } },
      variants: { include: { inventory: true }, orderBy: { createdAt: 'asc' } },
      attributeValues: { include: { definition: true } },
    },
  });
  if (!product) throw notFound('Product');

  return {
    ...product,
    attributes: Object.fromEntries(product.attributeValues.map((v) => [v.definition.key, v.value])),
    totalStock: roundQty(product.variants.reduce((sum, v) => sum + (v.inventory?.quantity ?? 0), 0)),
  };
}

export interface ProductListFilters {
  search?: string;
  categoryId?: string;
  brandId?: string;
  page?: number;
  pageSize?: number;
  includeInactive?: boolean;
}

export async function listProducts(scope: TenantScope, filters: ProductListFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
  const search = filters.search?.trim();

  const where = {
    businessId: scope.businessId,
    ...(filters.includeInactive ? {} : { isActive: true }),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.brandId ? { brandId: filters.brandId } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search } },
            { normalizedName: { contains: normalizeName(search) } },
            { variants: { some: { sku: { contains: search } } } },
            { variants: { some: { barcode: search } } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        unit: { select: { code: true, allowDecimal: true } },
        tax: { select: { rate: true } },
        variants: { include: { inventory: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items: items.map((product) => ({
      id: product.id,
      name: product.name,
      category: product.category?.name ?? null,
      brand: product.brand?.name ?? null,
      unit: product.unit.code,
      allowDecimal: product.unit.allowDecimal,
      taxRate: product.tax?.rate ?? 0,
      hasVariants: product.hasVariants,
      trackBatch: product.trackBatch,
      trackExpiry: product.trackExpiry,
      trackSerial: product.trackSerial,
      imageRef: product.imageRef,
      totalStock: roundQty(product.variants.reduce((sum, v) => sum + (v.inventory?.quantity ?? 0), 0)),
      variants: product.variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        sku: variant.sku,
        barcode: variant.barcode,
        options: JSON.parse(variant.options) as Record<string, string>,
        purchasePricePaise: variant.purchasePricePaise,
        sellingPricePaise: variant.sellingPricePaise,
        mrpPaise: variant.mrpPaise,
        minStock: variant.minStock,
        stock: roundQty(variant.inventory?.quantity ?? 0),
      })),
    })),
    total,
    page,
    pageSize,
  };
}

export async function findByBarcode(scope: TenantScope, barcode: string) {
  const variant = await prisma.productVariant.findFirst({
    where: { businessId: scope.businessId, barcode },
    include: {
      inventory: true,
      product: { include: { unit: true, tax: true, category: true, brand: true } },
    },
  });
  if (!variant) return null;
  return {
    variantId: variant.id,
    productId: variant.productId,
    name: variant.isDefault ? variant.product.name : `${variant.product.name} - ${variant.name}`,
    sku: variant.sku,
    barcode: variant.barcode,
    unit: variant.product.unit.code,
    allowDecimal: variant.product.unit.allowDecimal,
    taxRate: variant.product.tax?.rate ?? 0,
    purchasePricePaise: variant.purchasePricePaise,
    sellingPricePaise: variant.sellingPricePaise,
    mrpPaise: variant.mrpPaise,
    stock: roundQty(variant.inventory?.quantity ?? 0),
    trackBatch: variant.product.trackBatch,
    trackSerial: variant.product.trackSerial,
  };
}

/**
 * Internal EAN-13 barcode (prefix 200-299 is reserved for in-store use) so a
 * shop can print labels for loose or unbranded goods.
 */
export async function generateBarcode(scope: TenantScope, variantId: string) {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, businessId: scope.businessId },
  });
  if (!variant) throw notFound('Product');
  if (variant.barcode) return { barcode: variant.barcode, generated: false };

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const body = `200${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0')}`;
    const barcode = body + eanCheckDigit(body);
    const clash = await prisma.productVariant.findFirst({ where: { businessId: scope.businessId, barcode } });
    if (clash) continue;
    await prisma.productVariant.update({ where: { id: variantId }, data: { barcode } });
    return { barcode, generated: true };
  }
  throw conflict('Could not generate a barcode. Please try again.');
}

function eanCheckDigit(body12: string): string {
  const sum = body12
    .split('')
    .map(Number)
    .reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);
  return String((10 - (sum % 10)) % 10);
}

async function generateSku(tx: Tx, businessId: string, productName: string, index: number): Promise<string> {
  const base =
    normalizeName(productName)
      .split(' ')
      .map((w) => w.slice(0, 3))
      .join('')
      .toUpperCase()
      .slice(0, 9) || 'ITEM';
  for (let i = 0; i < 50; i += 1) {
    const candidate = `${base}-${String(Date.now() % 100000).padStart(5, '0')}${index + i}`;
    const exists = await tx.productVariant.findFirst({ where: { businessId, sku: candidate } });
    if (!exists) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function resolveUnitId(
  tx: Tx,
  businessId: string,
  unitId?: string | null,
  unitCode?: string | null,
): Promise<string> {
  if (unitId) return unitId;
  if (unitCode) {
    const unit = await tx.unit.findFirst({ where: { businessId, code: unitCode } });
    if (unit) return unit.id;
    const created = await tx.unit.create({
      data: { businessId, code: unitCode, name: unitCode, allowDecimal: ['KG', 'G', 'L', 'ML', 'M'].includes(unitCode) },
    });
    return created.id;
  }
  const fallback = await tx.unit.findFirst({ where: { businessId }, orderBy: { code: 'asc' } });
  if (!fallback) throw badRequest('No units are set up for this shop.');
  return fallback.id;
}

async function resolveCategoryId(tx: Tx, businessId: string, categoryId?: string | null, categoryName?: string | null) {
  if (categoryId) return categoryId;
  if (!categoryName) return null;
  const existing = await tx.category.findFirst({ where: { businessId, name: categoryName } });
  if (existing) return existing.id;
  const created = await tx.category.create({ data: { businessId, name: categoryName } });
  return created.id;
}

async function resolveBrandId(tx: Tx, businessId: string, brandId?: string | null, brandName?: string | null) {
  if (brandId) return brandId;
  if (!brandName) return null;
  const existing = await tx.brand.findFirst({ where: { businessId, name: brandName } });
  if (existing) return existing.id;
  const created = await tx.brand.create({ data: { businessId, name: brandName } });
  return created.id;
}

async function defaultTaxId(tx: Tx, businessId: string): Promise<string | null> {
  const tax = await tx.tax.findFirst({ where: { businessId, isDefault: true } });
  return tax?.id ?? null;
}
