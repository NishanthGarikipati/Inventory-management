import { prisma, txOptions, type Tx } from '../db/prisma.js';
import type { TenantScope } from '../db/tenant.js';
import { badRequest, conflict, notFound } from '../domain/errors.js';
import type { PaymentMethod, TransactionSource } from '../domain/enums.js';
import { allocateProportionally, computeLineTax, roundOffToRupee, roundQty } from '../domain/money.js';
import { allocateBatchesFefo, applyStockMovement, getBusinessSettings } from './inventory.service.js';
import { recordAudit } from './audit.service.js';
import { nextDocumentNumber } from './sequence.service.js';
import { refreshStockAlerts, raiseNotification } from './notification.service.js';

export interface SaleItemInput {
  variantId: string;
  quantity: number;
  unitPricePaise?: number;
  discountPaise?: number;
  batchId?: string | null;
  serials?: string[];
  note?: string;
}

export interface SalePaymentInput {
  method: PaymentMethod;
  amountPaise: number;
  reference?: string;
}

export interface CreateSaleInput {
  customerId?: string | null;
  items: SaleItemInput[];
  /** Bill level discount, spread across lines by value. */
  discountPaise?: number;
  payments: SalePaymentInput[];
  channel?: 'COUNTER' | 'TAKEAWAY' | 'DELIVERY' | 'TABLE';
  tableLabel?: string;
  note?: string;
  saleDate?: Date;
  clientRequestId?: string;
  source?: TransactionSource;
}

/**
 * Creates a sale end to end: stock out (with FEFO batches and recipe
 * consumption), payments, customer credit, COGS/profit and the receipt.
 * Everything happens in one database transaction - a half-recorded sale is
 * worse than a failed one.
 */
export async function createSale(scope: TenantScope, input: CreateSaleInput) {
  if (!input.items.length) throw badRequest('Add at least one product to the bill.');

  const sale = await prisma.$transaction(async (tx) => {
    const settings = await getBusinessSettings(tx, scope.businessId);
    const taxMode = settings.pricesIncludeTax ? 'INCLUSIVE' : 'EXCLUSIVE';

    const prepared = [];
    for (const item of input.items) {
      const quantity = roundQty(item.quantity);
      if (quantity <= 0) throw badRequest('Quantity must be more than zero.');

      const variant = await tx.productVariant.findFirst({
        where: { id: item.variantId, businessId: scope.businessId },
        include: { product: { include: { tax: true, unit: true } } },
      });
      if (!variant) throw notFound('Product');
      if (!variant.product.unit.allowDecimal && !Number.isInteger(quantity)) {
        throw badRequest(`${variant.product.name} is sold in whole ${variant.product.unit.name.toLowerCase()}s.`);
      }

      const unitPricePaise = item.unitPricePaise ?? variant.sellingPricePaise;
      if (unitPricePaise < 0) throw badRequest('Price cannot be negative.');
      const taxRate = settings.taxEnabled ? variant.product.tax?.rate ?? 0 : 0;

      prepared.push({
        item,
        variant,
        quantity,
        unitPricePaise,
        taxRate,
        lineValuePaise: Math.round(unitPricePaise * quantity) - Math.max(0, item.discountPaise ?? 0),
      });
    }

    const billDiscount = Math.max(0, Math.round(input.discountPaise ?? 0));
    const allocation = allocateProportionally(
      billDiscount,
      prepared.map((p) => Math.max(0, p.lineValuePaise)),
    );

    const invoiceNumber = await nextDocumentNumber(tx, scope.businessId, 'INVOICE', settings.invoicePrefix);

    const sale = await tx.sale.create({
      data: {
        businessId: scope.businessId,
        invoiceNumber,
        customerId: input.customerId ?? null,
        userId: scope.userId || null,
        saleDate: input.saleDate ?? new Date(),
        channel: input.channel ?? 'COUNTER',
        tableLabel: input.tableLabel ?? null,
        note: input.note ?? null,
        clientRequestId: input.clientRequestId ?? null,
      },
    });

    let subtotalPaise = 0;
    let taxPaise = 0;
    let discountPaise = 0;
    let cogsPaise = 0;

    for (const [index, line] of prepared.entries()) {
      const lineDiscount = Math.max(0, line.item.discountPaise ?? 0) + allocation[index];
      const math = computeLineTax({
        unitPricePaise: line.unitPricePaise,
        quantity: line.quantity,
        discountPaise: lineDiscount,
        taxRate: line.taxRate,
        mode: taxMode,
      });

      const consumption = await consumeStockForSale(tx, scope, {
        variant: line.variant,
        quantity: line.quantity,
        batchId: line.item.batchId ?? null,
        saleId: sale.id,
        allowNegativeStock: settings.allowNegativeStock,
        source: input.source ?? 'MANUAL',
      });

      for (const segment of consumption.segments) {
        const segmentRatio = segment.quantity / line.quantity;
        await tx.saleItem.create({
          data: {
            saleId: sale.id,
            variantId: line.variant.id,
            batchId: segment.batchId,
            productName: line.variant.isDefault
              ? line.variant.product.name
              : `${line.variant.product.name} - ${line.variant.name}`,
            quantity: segment.quantity,
            unitPricePaise: line.unitPricePaise,
            discountPaise: Math.round(lineDiscount * segmentRatio),
            taxRate: line.taxRate,
            taxPaise: Math.round(math.taxPaise * segmentRatio),
            totalPaise: Math.round(math.totalPaise * segmentRatio),
            costPaise: segment.cogsPaise,
          },
        });
      }

      if (line.item.serials?.length) {
        await markSerialsSold(tx, scope, line.variant.id, line.item.serials, sale.id);
      }

      subtotalPaise += math.taxablePaise;
      taxPaise += math.taxPaise;
      discountPaise += lineDiscount;
      cogsPaise += consumption.cogsPaise;
    }

    const beforeRounding = subtotalPaise + taxPaise;
    const { total, roundOff } = settings.roundOffSaleTotal
      ? roundOffToRupee(beforeRounding)
      : { total: beforeRounding, roundOff: 0 };

    const tenderedPaise = input.payments
      .filter((p) => p.method !== 'CREDIT')
      .reduce((sum, p) => sum + Math.round(p.amountPaise), 0);

    // A customer handing over a ₹500 note for a ₹494 bill is normal: the
    // excess is change, not an error. Only the bill amount is recorded as
    // paid, so payment reports stay honest.
    const changePaise = Math.max(0, tenderedPaise - total);
    if (changePaise > 0 && !input.payments.some((p) => p.method === 'CASH')) {
      throw badRequest('Payment is more than the bill amount. Please check.');
    }
    const paidPaise = Math.min(tenderedPaise, total);
    const duePaise = Math.max(0, total - paidPaise);
    if (duePaise > 0 && !input.customerId) {
      throw badRequest('Choose a customer before giving credit.', [
        { label: 'Select Customer', action: 'SELECT_CUSTOMER' },
        { label: 'Take Full Payment', action: 'COLLECT_FULL' },
      ]);
    }

    let changeToDeduct = changePaise;
    for (const payment of input.payments) {
      if (payment.amountPaise <= 0 || payment.method === 'CREDIT') continue;
      let amountPaise = Math.round(payment.amountPaise);
      if (payment.method === 'CASH' && changeToDeduct > 0) {
        const deduction = Math.min(changeToDeduct, amountPaise);
        amountPaise -= deduction;
        changeToDeduct -= deduction;
      }
      if (amountPaise <= 0) continue;
      await tx.salePayment.create({
        data: {
          saleId: sale.id,
          method: payment.method,
          amountPaise,
          reference: payment.reference ?? null,
        },
      });
    }

    if (input.customerId) {
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, businessId: scope.businessId },
      });
      if (!customer) throw notFound('Customer');
      if (duePaise > 0) {
        const newBalance = customer.balancePaise + duePaise;
        if (customer.creditLimitPaise > 0 && newBalance > customer.creditLimitPaise) {
          throw conflict(
            `This bill takes ${customer.name} to ₹${(newBalance / 100).toFixed(0)}, above their ₹${(
              customer.creditLimitPaise / 100
            ).toFixed(0)} credit limit.`,
            [
              { label: 'Collect Payment', action: 'COLLECT_PAYMENT' },
              { label: 'Continue Anyway', action: 'OVERRIDE_CREDIT_LIMIT' },
            ],
          );
        }
        await tx.customer.update({
          where: { id: customer.id },
          data: { balancePaise: newBalance },
        });
      }
    }

    // subtotal is already net of discount and excludes tax, so it is the
    // revenue the shop actually keeps before cost of goods.
    const grossProfitPaise = subtotalPaise - cogsPaise;

    const updated = await tx.sale.update({
      where: { id: sale.id },
      data: {
        subtotalPaise,
        discountPaise,
        taxPaise,
        roundOffPaise: roundOff,
        totalPaise: total,
        paidPaise,
        duePaise,
        cogsPaise,
        grossProfitPaise,
      },
      include: { items: true, payments: true, customer: true },
    });

    const business = await tx.business.findUnique({ where: { id: scope.businessId } });
    await tx.invoice.create({
      data: {
        businessId: scope.businessId,
        saleId: sale.id,
        number: invoiceNumber,
        payload: JSON.stringify(buildReceipt(updated, business, settings)),
      },
    });

    await recordAudit(tx, scope, {
      action: 'SALE_CREATED',
      entityType: 'Sale',
      entityId: sale.id,
      after: { invoiceNumber, totalPaise: total, items: updated.items.length },
      source: input.source ?? 'MANUAL',
    });

    return { ...updated, changePaise };
  }, txOptions);

  await refreshStockAlerts(scope.businessId, sale.items.map((i) => i.variantId));
  return { ...(await getSale(scope, sale.id)), changePaise: sale.changePaise };
}

interface ConsumeInput {
  variant: { id: string; productId: string; isDefault: boolean; name: string; product: { name: string; trackBatch: boolean; isComposite: boolean } };
  quantity: number;
  batchId: string | null;
  saleId: string;
  allowNegativeStock: boolean;
  source: TransactionSource;
}

/**
 * Menu items and cakes consume their recipe ingredients; everything else moves
 * its own stock, using FEFO batches where the product is batch tracked.
 */
async function consumeStockForSale(
  tx: Tx,
  scope: TenantScope,
  input: ConsumeInput,
): Promise<{ cogsPaise: number; segments: Array<{ quantity: number; batchId: string | null; cogsPaise: number }> }> {
  if (input.variant.product.isComposite) {
    const recipe = await tx.recipe.findFirst({
      where: { businessId: scope.businessId, productId: input.variant.productId, isActive: true, autoConsumeOnSale: true },
      include: { items: true },
    });
    if (recipe) {
      let cogsPaise = 0;
      for (const ingredient of recipe.items) {
        const movement = await applyStockMovement(
          tx,
          scope,
          {
            variantId: ingredient.variantId,
            quantity: -roundQty((ingredient.quantity * input.quantity) / (recipe.yieldQty || 1)),
            type: 'CONSUMPTION',
            referenceType: 'SALE',
            referenceId: input.saleId,
            source: input.source,
            note: `Used for ${input.variant.product.name}`,
          },
          { allowNegativeStock: true },
        );
        cogsPaise += movement.cogsPaise;
      }
      return { cogsPaise, segments: [{ quantity: input.quantity, batchId: null, cogsPaise }] };
    }
  }

  if (input.variant.product.trackBatch && !input.batchId) {
    const picks = await allocateBatchesFefo(tx, scope.businessId, input.variant.id, input.quantity);
    const pickedQty = picks.reduce((sum, p) => sum + p.quantity, 0);
    if (picks.length && roundQty(pickedQty) >= input.quantity) {
      const segments = [];
      let cogsPaise = 0;
      for (const pick of picks) {
        const movement = await applyStockMovement(
          tx,
          scope,
          {
            variantId: input.variant.id,
            quantity: -pick.quantity,
            type: 'SALE',
            batchId: pick.batchId,
            referenceType: 'SALE',
            referenceId: input.saleId,
            source: input.source,
          },
          { allowNegativeStock: input.allowNegativeStock },
        );
        segments.push({ quantity: pick.quantity, batchId: pick.batchId, cogsPaise: movement.cogsPaise });
        cogsPaise += movement.cogsPaise;
      }
      return { cogsPaise, segments };
    }
  }

  const movement = await applyStockMovement(
    tx,
    scope,
    {
      variantId: input.variant.id,
      quantity: -input.quantity,
      type: 'SALE',
      batchId: input.batchId,
      referenceType: 'SALE',
      referenceId: input.saleId,
      source: input.source,
    },
    { allowNegativeStock: input.allowNegativeStock },
  );
  return {
    cogsPaise: movement.cogsPaise,
    segments: [{ quantity: input.quantity, batchId: input.batchId, cogsPaise: movement.cogsPaise }],
  };
}

async function markSerialsSold(tx: Tx, scope: TenantScope, variantId: string, serials: string[], saleId: string) {
  for (const serial of serials) {
    const item = await tx.serialItem.findFirst({
      where: { businessId: scope.businessId, variantId, serial },
    });
    if (!item) throw badRequest(`Serial number ${serial} is not in stock.`);
    if (item.status !== 'IN_STOCK') throw conflict(`Serial number ${serial} is already sold.`);
    await tx.serialItem.update({
      where: { id: item.id },
      data: { status: 'SOLD', saleId, soldAt: new Date() },
    });
  }
}

export async function getSale(scope: TenantScope, saleId: string) {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, businessId: scope.businessId },
    include: {
      items: { include: { variant: { include: { product: { select: { name: true, unitId: true } } } }, batch: true } },
      payments: true,
      customer: true,
      user: { select: { id: true, name: true } },
      invoice: true,
      returns: { include: { items: true } },
    },
  });
  if (!sale) throw notFound('Sale');
  return sale;
}

export async function listSales(
  scope: TenantScope,
  filters: { from?: Date; to?: Date; customerId?: string; status?: string; page?: number; pageSize?: number },
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 25));
  const where = {
    businessId: scope.businessId,
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.from || filters.to
      ? { saleDate: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      include: { customer: { select: { id: true, name: true } }, payments: true, _count: { select: { items: true } } },
      orderBy: { saleDate: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.sale.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

/**
 * Cancelling a sale never edits history: it writes reversing stock
 * transactions, refunds credit and leaves the original bill visible.
 */
export async function cancelSale(scope: TenantScope, saleId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id: saleId, businessId: scope.businessId },
      include: { items: true },
    });
    if (!sale) throw notFound('Sale');
    if (sale.status === 'CANCELLED') throw conflict('This bill is already cancelled.');

    for (const item of sale.items) {
      await applyStockMovement(tx, scope, {
        variantId: item.variantId,
        quantity: item.quantity,
        type: 'SALE_RETURN',
        batchId: item.batchId,
        unitCostPaise: item.quantity > 0 ? Math.round(item.costPaise / item.quantity) : 0,
        referenceType: 'SALE_CANCELLATION',
        referenceId: sale.id,
        note: reason,
      });
    }

    if (sale.customerId && sale.duePaise > 0) {
      await tx.customer.update({
        where: { id: sale.customerId },
        data: { balancePaise: { decrement: sale.duePaise } },
      });
    }

    const updated = await tx.sale.update({
      where: { id: sale.id },
      data: { status: 'CANCELLED', note: [sale.note, `Cancelled: ${reason}`].filter(Boolean).join(' | ') },
    });

    await recordAudit(tx, scope, {
      action: 'SALE_CANCELLED',
      entityType: 'Sale',
      entityId: sale.id,
      before: { status: sale.status, totalPaise: sale.totalPaise },
      after: { status: 'CANCELLED', reason },
    });

    await raiseNotification(tx, scope.businessId, {
      type: 'SCAN_REVIEW',
      title: 'Bill cancelled',
      body: `${sale.invoiceNumber} was cancelled. Stock has been returned.`,
      severity: 'INFO',
      dedupeKey: `sale-cancelled-${sale.id}`,
      refType: 'Sale',
      refId: sale.id,
    });

    return updated;
  }, txOptions);
}

import type { Prisma } from '@prisma/client';

type SaleWithRelations = Prisma.SaleGetPayload<{
  include: { items: true; payments: true; customer: true };
}>;

function buildReceipt(
  sale: SaleWithRelations,
  business: { name: string; address: string | null; phone: string; gstin: string | null } | null,
  settings: { taxLabel: string; pricesIncludeTax: boolean },
) {
  return {
    shop: {
      name: business?.name ?? '',
      address: business?.address ?? '',
      phone: business?.phone ?? '',
      gstin: business?.gstin ?? null,
    },
    invoiceNumber: sale.invoiceNumber,
    date: sale.saleDate,
    customer: sale.customer ? { name: sale.customer.name, phone: sale.customer.phone } : null,
    items: sale.items.map((item) => ({
      name: item.productName,
      quantity: item.quantity,
      unitPricePaise: item.unitPricePaise,
      discountPaise: item.discountPaise,
      taxRate: item.taxRate,
      taxPaise: item.taxPaise,
      totalPaise: item.totalPaise,
    })),
    subtotalPaise: sale.subtotalPaise,
    discountPaise: sale.discountPaise,
    taxLabel: settings.taxLabel,
    taxPaise: sale.taxPaise,
    roundOffPaise: sale.roundOffPaise,
    totalPaise: sale.totalPaise,
    paidPaise: sale.paidPaise,
    duePaise: sale.duePaise,
    pricesIncludeTax: settings.pricesIncludeTax,
    payments: sale.payments.map((p) => ({ method: p.method, amountPaise: p.amountPaise })),
  };
}
