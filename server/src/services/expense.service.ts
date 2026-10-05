import { prisma } from '../db/prisma.js';
import type { TenantScope } from '../db/tenant.js';
import { badRequest, notFound } from '../domain/errors.js';
import type { PaymentMethod } from '../domain/enums.js';

export async function createExpense(
  scope: TenantScope,
  input: {
    categoryId?: string | null;
    categoryName?: string | null;
    amountPaise: number;
    method?: PaymentMethod;
    description?: string;
    expenseDate?: Date;
  },
) {
  if (input.amountPaise <= 0) throw badRequest('Enter an amount more than zero.');

  let categoryId = input.categoryId ?? null;
  if (!categoryId && input.categoryName) {
    const category = await prisma.expenseCategory.upsert({
      where: { businessId_name: { businessId: scope.businessId, name: input.categoryName } },
      create: { businessId: scope.businessId, name: input.categoryName },
      update: {},
    });
    categoryId = category.id;
  }

  return prisma.expense.create({
    data: {
      businessId: scope.businessId,
      categoryId,
      amountPaise: Math.round(input.amountPaise),
      method: input.method ?? 'CASH',
      description: input.description ?? null,
      expenseDate: input.expenseDate ?? new Date(),
      userId: scope.userId || null,
    },
    include: { category: true },
  });
}

export async function listExpenses(
  scope: TenantScope,
  filters: { from?: Date; to?: Date; categoryId?: string; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
  const where = {
    businessId: scope.businessId,
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.from || filters.to
      ? { expenseDate: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
  };
  const [items, total, sum] = await Promise.all([
    prisma.expense.findMany({
      where,
      include: { category: true },
      orderBy: { expenseDate: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amountPaise: true } }),
  ]);
  return { items, total, page, pageSize, totalAmountPaise: sum._sum.amountPaise ?? 0 };
}

export async function deleteExpense(scope: TenantScope, id: string) {
  const expense = await prisma.expense.findFirst({ where: { id, businessId: scope.businessId } });
  if (!expense) throw notFound('Expense');
  await prisma.expense.delete({ where: { id } });
}

export async function listExpenseCategories(scope: TenantScope) {
  return prisma.expenseCategory.findMany({
    where: { businessId: scope.businessId },
    orderBy: { name: 'asc' },
  });
}
