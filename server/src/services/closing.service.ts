import { prisma } from '../db/prisma.js';
import type { TenantScope } from '../db/tenant.js';
import { conflict } from '../domain/errors.js';
import { recordAudit } from './audit.service.js';
import { dayRange } from '../utils/dates.js';

/**
 * Day close: what the app thinks is in the cash box vs what the owner counted.
 * Optional by design - a shop that skips it loses nothing else.
 */
export async function getDaySummary(scope: TenantScope, date: Date) {
  const { start, end } = dayRange(date);

  const [sales, expenses, collections, existing] = await Promise.all([
    prisma.sale.findMany({
      where: { businessId: scope.businessId, status: 'COMPLETED', saleDate: { gte: start, lte: end } },
      include: { payments: true },
    }),
    prisma.expense.aggregate({
      where: { businessId: scope.businessId, expenseDate: { gte: start, lte: end } },
      _sum: { amountPaise: true },
      _count: true,
    }),
    prisma.customerPayment.aggregate({
      where: { businessId: scope.businessId, createdAt: { gte: start, lte: end } },
      _sum: { amountPaise: true },
    }),
    prisma.dailyClosing.findFirst({
      where: { businessId: scope.businessId, closingDate: { gte: start, lte: end } },
    }),
  ]);

  const byMethod = { CASH: 0, UPI: 0, CARD: 0, CREDIT: 0, OTHER: 0 } as Record<string, number>;
  let salesPaise = 0;
  for (const sale of sales) {
    salesPaise += sale.totalPaise;
    let tenderedPaise = 0;
    for (const payment of sale.payments) {
      byMethod[payment.method] = (byMethod[payment.method] ?? 0) + payment.amountPaise;
      tenderedPaise += payment.amountPaise;
    }
    // Credit given today, taken from the bill itself: a collection made later
    // the same day shows up under collections, not as less credit given.
    byMethod.CREDIT += Math.max(0, sale.totalPaise - tenderedPaise);
  }

  const expensesPaise = expenses._sum.amountPaise ?? 0;
  const collectionPaise = collections._sum.amountPaise ?? 0;
  const expectedCashPaise = byMethod.CASH + collectionPaise - expensesPaise;

  return {
    date: start,
    billCount: sales.length,
    salesPaise,
    cashPaise: byMethod.CASH,
    upiPaise: byMethod.UPI,
    cardPaise: byMethod.CARD,
    creditPaise: byMethod.CREDIT,
    otherPaise: byMethod.OTHER,
    expensesPaise,
    expenseCount: expenses._count,
    customerCollectionPaise: collectionPaise,
    expectedCashPaise,
    closed: Boolean(existing),
    closing: existing,
  };
}

export async function closeDay(
  scope: TenantScope,
  input: { date?: Date; actualCashPaise: number; note?: string },
) {
  const date = input.date ?? new Date();
  const { start } = dayRange(date);
  const summary = await getDaySummary(scope, date);
  if (summary.closed) throw conflict('This day is already closed.');

  const closing = await prisma.dailyClosing.create({
    data: {
      businessId: scope.businessId,
      closingDate: start,
      salesPaise: summary.salesPaise,
      cashPaise: summary.cashPaise,
      upiPaise: summary.upiPaise,
      cardPaise: summary.cardPaise,
      creditPaise: summary.creditPaise,
      otherPaise: summary.otherPaise,
      expensesPaise: summary.expensesPaise,
      customerCollectionPaise: summary.customerCollectionPaise,
      expectedCashPaise: summary.expectedCashPaise,
      actualCashPaise: input.actualCashPaise,
      differencePaise: input.actualCashPaise - summary.expectedCashPaise,
      note: input.note ?? null,
      userId: scope.userId || null,
    },
  });

  await recordAudit(prisma, scope, {
    action: 'DAY_CLOSED',
    entityType: 'DailyClosing',
    entityId: closing.id,
    after: {
      expectedCashPaise: summary.expectedCashPaise,
      actualCashPaise: input.actualCashPaise,
      differencePaise: closing.differencePaise,
    },
  });

  return closing;
}

export async function listClosings(scope: TenantScope, limit = 30) {
  return prisma.dailyClosing.findMany({
    where: { businessId: scope.businessId },
    orderBy: { closingDate: 'desc' },
    take: Math.min(180, limit),
  });
}
