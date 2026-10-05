import { prisma } from '../db/prisma.js';
import type { TenantScope } from '../db/tenant.js';
import { roundQty } from '../domain/money.js';
import { dayRange, formatDateKey, resolveRange, type DatePreset } from '../utils/dates.js';
import { resolveFeatures, templateByCode } from '../domain/businessTypes.js';

export interface RangeInput {
  preset?: DatePreset;
  from?: string;
  to?: string;
}

/**
 * The home screen. One query set, one shape, answering: what came in today,
 * what needs attention, what is waiting for me.
 */
export async function getDashboard(scope: TenantScope) {
  const { start, end } = dayRange(new Date());

  const [business, settings, salesAgg, purchaseAgg, expenseAgg, inventoryRows, dueCustomers, dueSuppliers, pendingScans, topProducts] =
    await Promise.all([
      prisma.business.findUnique({ where: { id: scope.businessId } }),
      prisma.businessSettings.findUnique({ where: { businessId: scope.businessId } }),
      prisma.sale.aggregate({
        where: { businessId: scope.businessId, status: 'COMPLETED', saleDate: { gte: start, lte: end } },
        _sum: { totalPaise: true, grossProfitPaise: true, duePaise: true, cogsPaise: true },
        _count: true,
      }),
      prisma.purchase.aggregate({
        where: { businessId: scope.businessId, status: 'COMPLETED', purchaseDate: { gte: start, lte: end } },
        _sum: { totalPaise: true },
        _count: true,
      }),
      prisma.expense.aggregate({
        where: { businessId: scope.businessId, expenseDate: { gte: start, lte: end } },
        _sum: { amountPaise: true },
      }),
      prisma.inventory.findMany({
        where: { businessId: scope.businessId },
        include: { variant: { select: { minStock: true, isActive: true } } },
      }),
      prisma.customer.aggregate({
        where: { businessId: scope.businessId, balancePaise: { gt: 0 } },
        _sum: { balancePaise: true },
        _count: true,
      }),
      prisma.supplier.aggregate({
        where: { businessId: scope.businessId, balancePaise: { gt: 0 } },
        _sum: { balancePaise: true },
        _count: true,
      }),
      prisma.imageScan.count({ where: { businessId: scope.businessId, status: 'REVIEW_REQUIRED' } }),
      topSellingProducts(scope, { preset: 'THIS_MONTH' }, 5),
    ]);

  const active = inventoryRows.filter((row) => row.variant.isActive);
  const stockValuePaise = active.reduce((sum, row) => sum + Math.round(row.quantity * row.avgCostPaise), 0);
  const lowStock = active.filter((row) => row.variant.minStock > 0 && row.quantity > 0 && row.quantity <= row.variant.minStock).length;
  const outOfStock = active.filter((row) => row.quantity <= 0).length;

  const expiryCutoff = new Date(Date.now() + (settings?.expiryAlertDays ?? 30) * 86400_000);
  const expiringSoon = await prisma.batch.count({
    where: { businessId: scope.businessId, quantity: { gt: 0 }, expiryDate: { not: null, lte: expiryCutoff } },
  });

  const features = resolveFeatures(business?.businessType ?? '', settings?.featureOverrides);
  const template = templateByCode(business?.businessType ?? '');

  return {
    greeting: greeting(),
    business: business
      ? { id: business.id, name: business.name, type: business.businessType, currency: business.currency }
      : null,
    today: {
      salesPaise: salesAgg._sum.totalPaise ?? 0,
      billCount: salesAgg._count,
      purchasesPaise: purchaseAgg._sum.totalPaise ?? 0,
      expensesPaise: expenseAgg._sum.amountPaise ?? 0,
      grossProfitPaise: salesAgg._sum.grossProfitPaise ?? 0,
      creditGivenPaise: salesAgg._sum.duePaise ?? 0,
    },
    alerts: {
      lowStock,
      outOfStock,
      expiringSoon,
      customerDuePaise: dueCustomers._sum.balancePaise ?? 0,
      customerDueCount: dueCustomers._count,
      supplierDuePaise: dueSuppliers._sum.balancePaise ?? 0,
      supplierDueCount: dueSuppliers._count,
      scansAwaitingReview: pendingScans,
    },
    stockValuePaise,
    topProducts,
    features,
    highlights: template?.dashboardHighlights ?? [],
  };
}

const greeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

export async function salesReport(scope: TenantScope, range: RangeInput) {
  const { start, end, label } = resolveRange(range.preset, range.from, range.to);
  const sales = await prisma.sale.findMany({
    where: { businessId: scope.businessId, status: 'COMPLETED', saleDate: { gte: start, lte: end } },
    include: { payments: true },
    orderBy: { saleDate: 'asc' },
  });

  const byDay = new Map<string, { salesPaise: number; bills: number; profitPaise: number }>();
  const byMethod: Record<string, number> = {};
  let totalPaise = 0;
  let profitPaise = 0;
  let taxPaise = 0;
  let discountPaise = 0;
  let duePaise = 0;

  for (const sale of sales) {
    const key = formatDateKey(sale.saleDate);
    const bucket = byDay.get(key) ?? { salesPaise: 0, bills: 0, profitPaise: 0 };
    bucket.salesPaise += sale.totalPaise;
    bucket.profitPaise += sale.grossProfitPaise;
    bucket.bills += 1;
    byDay.set(key, bucket);

    totalPaise += sale.totalPaise;
    profitPaise += sale.grossProfitPaise;
    taxPaise += sale.taxPaise;
    discountPaise += sale.discountPaise;
    duePaise += sale.duePaise;
    for (const payment of sale.payments) {
      byMethod[payment.method] = (byMethod[payment.method] ?? 0) + payment.amountPaise;
    }
  }

  return {
    range: { start, end, label },
    totals: {
      salesPaise: totalPaise,
      billCount: sales.length,
      grossProfitPaise: profitPaise,
      taxPaise,
      discountPaise,
      duePaise,
      averageBillPaise: sales.length ? Math.round(totalPaise / sales.length) : 0,
    },
    byDay: [...byDay.entries()].map(([date, value]) => ({ date, ...value })),
    byPaymentMethod: byMethod,
  };
}

export async function topSellingProducts(scope: TenantScope, range: RangeInput, limit = 10) {
  const { start, end } = resolveRange(range.preset, range.from, range.to);
  const items = await prisma.saleItem.findMany({
    where: { sale: { businessId: scope.businessId, status: 'COMPLETED', saleDate: { gte: start, lte: end } } },
    select: { variantId: true, productName: true, quantity: true, totalPaise: true, costPaise: true, taxPaise: true },
  });

  const byVariant = new Map<string, { name: string; quantity: number; revenuePaise: number; profitPaise: number }>();
  for (const item of items) {
    const bucket = byVariant.get(item.variantId) ?? {
      name: item.productName,
      quantity: 0,
      revenuePaise: 0,
      profitPaise: 0,
    };
    bucket.quantity = roundQty(bucket.quantity + item.quantity);
    bucket.revenuePaise += item.totalPaise;
    bucket.profitPaise += item.totalPaise - item.taxPaise - item.costPaise;
    byVariant.set(item.variantId, bucket);
  }

  return [...byVariant.entries()]
    .map(([variantId, value]) => ({ variantId, ...value }))
    .sort((a, b) => b.revenuePaise - a.revenuePaise)
    .slice(0, limit);
}

export async function salesByCategory(scope: TenantScope, range: RangeInput) {
  const { start, end } = resolveRange(range.preset, range.from, range.to);
  const items = await prisma.saleItem.findMany({
    where: { sale: { businessId: scope.businessId, status: 'COMPLETED', saleDate: { gte: start, lte: end } } },
    include: { variant: { include: { product: { include: { category: true } } } } },
  });

  const byCategory = new Map<string, { revenuePaise: number; quantity: number; profitPaise: number }>();
  for (const item of items) {
    const name = item.variant.product.category?.name ?? 'Uncategorised';
    const bucket = byCategory.get(name) ?? { revenuePaise: 0, quantity: 0, profitPaise: 0 };
    bucket.revenuePaise += item.totalPaise;
    bucket.quantity = roundQty(bucket.quantity + item.quantity);
    bucket.profitPaise += item.totalPaise - item.taxPaise - item.costPaise;
    byCategory.set(name, bucket);
  }

  return [...byCategory.entries()]
    .map(([category, value]) => ({ category, ...value }))
    .sort((a, b) => b.revenuePaise - a.revenuePaise);
}

export async function profitReport(scope: TenantScope, range: RangeInput) {
  const { start, end, label } = resolveRange(range.preset, range.from, range.to);
  const [sales, expenses, returns] = await Promise.all([
    prisma.sale.aggregate({
      where: { businessId: scope.businessId, status: 'COMPLETED', saleDate: { gte: start, lte: end } },
      _sum: { totalPaise: true, taxPaise: true, cogsPaise: true, grossProfitPaise: true, discountPaise: true },
    }),
    prisma.expense.aggregate({
      where: { businessId: scope.businessId, expenseDate: { gte: start, lte: end } },
      _sum: { amountPaise: true },
    }),
    prisma.salesReturn.aggregate({
      where: { businessId: scope.businessId, createdAt: { gte: start, lte: end } },
      _sum: { totalPaise: true },
    }),
  ]);

  const revenuePaise = (sales._sum.totalPaise ?? 0) - (sales._sum.taxPaise ?? 0);
  const cogsPaise = sales._sum.cogsPaise ?? 0;
  const grossProfitPaise = sales._sum.grossProfitPaise ?? 0;
  const expensesPaise = expenses._sum.amountPaise ?? 0;
  const returnsPaise = returns._sum.totalPaise ?? 0;

  return {
    range: { start, end, label },
    revenuePaise,
    returnsPaise,
    cogsPaise,
    grossProfitPaise,
    expensesPaise,
    /** Estimated, not audited - never presented to the owner as final profit. */
    estimatedNetProfitPaise: grossProfitPaise - expensesPaise - returnsPaise,
    taxCollectedPaise: sales._sum.taxPaise ?? 0,
    discountGivenPaise: sales._sum.discountPaise ?? 0,
  };
}

export async function purchaseReport(scope: TenantScope, range: RangeInput) {
  const { start, end, label } = resolveRange(range.preset, range.from, range.to);
  const purchases = await prisma.purchase.findMany({
    where: { businessId: scope.businessId, status: 'COMPLETED', purchaseDate: { gte: start, lte: end } },
    include: { supplier: { select: { name: true } } },
  });

  const bySupplier = new Map<string, { totalPaise: number; count: number; duePaise: number }>();
  for (const purchase of purchases) {
    const name = purchase.supplier?.name ?? 'Unknown supplier';
    const bucket = bySupplier.get(name) ?? { totalPaise: 0, count: 0, duePaise: 0 };
    bucket.totalPaise += purchase.totalPaise;
    bucket.duePaise += purchase.duePaise;
    bucket.count += 1;
    bySupplier.set(name, bucket);
  }

  return {
    range: { start, end, label },
    totals: {
      purchasePaise: purchases.reduce((sum, p) => sum + p.totalPaise, 0),
      count: purchases.length,
      duePaise: purchases.reduce((sum, p) => sum + p.duePaise, 0),
    },
    bySupplier: [...bySupplier.entries()].map(([supplier, value]) => ({ supplier, ...value })),
  };
}

export async function inventoryReport(scope: TenantScope) {
  const rows = await prisma.inventory.findMany({
    where: { businessId: scope.businessId },
    include: {
      variant: {
        include: { product: { include: { category: true } } },
      },
    },
  });

  const items = rows
    .filter((row) => row.variant.isActive)
    .map((row) => ({
      variantId: row.variantId,
      name: row.variant.isDefault ? row.variant.product.name : `${row.variant.product.name} - ${row.variant.name}`,
      category: row.variant.product.category?.name ?? 'Uncategorised',
      quantity: roundQty(row.quantity),
      minStock: row.variant.minStock,
      avgCostPaise: row.avgCostPaise,
      stockValuePaise: Math.round(row.quantity * row.avgCostPaise),
      sellingPricePaise: row.variant.sellingPricePaise,
    }))
    .sort((a, b) => b.stockValuePaise - a.stockValuePaise);

  return {
    items,
    totals: {
      products: items.length,
      stockValuePaise: items.reduce((sum, i) => sum + i.stockValuePaise, 0),
      retailValuePaise: items.reduce((sum, i) => sum + Math.round(i.quantity * i.sellingPricePaise), 0),
    },
  };
}

export async function outstandingReport(scope: TenantScope) {
  const [customers, suppliers] = await Promise.all([
    prisma.customer.findMany({
      where: { businessId: scope.businessId, balancePaise: { gt: 0 } },
      orderBy: { balancePaise: 'desc' },
      select: { id: true, name: true, phone: true, balancePaise: true },
    }),
    prisma.supplier.findMany({
      where: { businessId: scope.businessId, balancePaise: { gt: 0 } },
      orderBy: { balancePaise: 'desc' },
      select: { id: true, name: true, phone: true, balancePaise: true },
    }),
  ]);

  return {
    customers,
    suppliers,
    totals: {
      customerDuePaise: customers.reduce((sum, c) => sum + c.balancePaise, 0),
      supplierDuePaise: suppliers.reduce((sum, s) => sum + s.balancePaise, 0),
    },
  };
}

export async function stockMovementReport(scope: TenantScope, range: RangeInput, variantId?: string) {
  const { start, end, label } = resolveRange(range.preset, range.from, range.to);
  const transactions = await prisma.inventoryTransaction.findMany({
    where: {
      businessId: scope.businessId,
      ...(variantId ? { variantId } : {}),
      createdAt: { gte: start, lte: end },
    },
    include: { variant: { include: { product: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });

  const byType: Record<string, number> = {};
  for (const transaction of transactions) {
    byType[transaction.type] = roundQty((byType[transaction.type] ?? 0) + transaction.quantity);
  }

  return {
    range: { start, end, label },
    byType,
    transactions: transactions.map((t) => ({
      id: t.id,
      date: t.createdAt,
      product: t.variant.isDefault ? t.variant.product.name : `${t.variant.product.name} - ${t.variant.name}`,
      type: t.type,
      quantity: t.quantity,
      previousStock: t.previousStock,
      newStock: t.newStock,
      source: t.source,
      referenceType: t.referenceType,
      referenceId: t.referenceId,
    })),
  };
}

export async function expenseReport(scope: TenantScope, range: RangeInput) {
  const { start, end, label } = resolveRange(range.preset, range.from, range.to);
  const expenses = await prisma.expense.findMany({
    where: { businessId: scope.businessId, expenseDate: { gte: start, lte: end } },
    include: { category: true },
  });

  const byCategory = new Map<string, number>();
  for (const expense of expenses) {
    const name = expense.category?.name ?? 'Other';
    byCategory.set(name, (byCategory.get(name) ?? 0) + expense.amountPaise);
  }

  return {
    range: { start, end, label },
    totalPaise: expenses.reduce((sum, e) => sum + e.amountPaise, 0),
    byCategory: [...byCategory.entries()].map(([category, amountPaise]) => ({ category, amountPaise })),
    count: expenses.length,
  };
}

export async function paymentSummary(scope: TenantScope, range: RangeInput) {
  const { start, end, label } = resolveRange(range.preset, range.from, range.to);
  const [salePayments, customerPayments, supplierPayments] = await Promise.all([
    prisma.salePayment.findMany({
      where: { sale: { businessId: scope.businessId, saleDate: { gte: start, lte: end }, status: 'COMPLETED' } },
    }),
    prisma.customerPayment.aggregate({
      where: { businessId: scope.businessId, createdAt: { gte: start, lte: end } },
      _sum: { amountPaise: true },
      _count: true,
    }),
    prisma.supplierPayment.aggregate({
      where: { businessId: scope.businessId, createdAt: { gte: start, lte: end } },
      _sum: { amountPaise: true },
      _count: true,
    }),
  ]);

  const byMethod: Record<string, number> = {};
  for (const payment of salePayments) {
    byMethod[payment.method] = (byMethod[payment.method] ?? 0) + payment.amountPaise;
  }

  return {
    range: { start, end, label },
    salesByMethod: byMethod,
    customerCollectionPaise: customerPayments._sum.amountPaise ?? 0,
    customerCollectionCount: customerPayments._count,
    supplierPaidPaise: supplierPayments._sum.amountPaise ?? 0,
    supplierPaidCount: supplierPayments._count,
  };
}

export async function scanHistoryReport(scope: TenantScope, range: RangeInput) {
  const { start, end, label } = resolveRange(range.preset, range.from, range.to);
  const scans = await prisma.imageScan.findMany({
    where: { businessId: scope.businessId, createdAt: { gte: start, lte: end } },
    include: { _count: { select: { items: true } }, approvals: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return {
    range: { start, end, label },
    scans: scans.map((scan) => ({
      id: scan.id,
      type: scan.scanType,
      status: scan.status,
      supplier: scan.extractedSupplierName,
      itemCount: scan._count.items,
      confidence: scan.overallConfidence,
      createdAt: scan.createdAt,
      approvedAt: scan.approvals[0]?.approvedAt ?? null,
      resultRefType: scan.resultRefType,
      resultRefId: scan.resultRefId,
    })),
    totals: {
      total: scans.length,
      approved: scans.filter((s) => s.status === 'APPROVED').length,
      pending: scans.filter((s) => s.status === 'REVIEW_REQUIRED').length,
      rejected: scans.filter((s) => s.status === 'REJECTED').length,
      failed: scans.filter((s) => s.status === 'FAILED').length,
    },
  };
}
