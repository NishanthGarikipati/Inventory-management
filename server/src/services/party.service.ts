import { prisma, txOptions } from '../db/prisma.js';
import type { TenantScope } from '../db/tenant.js';
import { badRequest, notFound } from '../domain/errors.js';
import type { PaymentMethod } from '../domain/enums.js';
import { normalizeName } from '../utils/text.js';
import { recordAudit } from './audit.service.js';

export interface PartyInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  gstin?: string | null;
  creditLimitPaise?: number;
  openingBalancePaise?: number;
}

export async function createCustomer(scope: TenantScope, input: PartyInput) {
  if (!input.name.trim()) throw badRequest('Please enter the customer name.');
  return prisma.customer.create({
    data: {
      businessId: scope.businessId,
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      email: input.email ?? null,
      address: input.address ?? null,
      gstin: input.gstin ?? null,
      creditLimitPaise: input.creditLimitPaise ?? 0,
      balancePaise: input.openingBalancePaise ?? 0,
    },
  });
}

export async function updateCustomer(scope: TenantScope, id: string, input: Partial<PartyInput>) {
  const existing = await prisma.customer.findFirst({ where: { id, businessId: scope.businessId } });
  if (!existing) throw notFound('Customer');
  return prisma.customer.update({
    where: { id },
    data: {
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.gstin !== undefined ? { gstin: input.gstin } : {}),
      ...(input.creditLimitPaise !== undefined ? { creditLimitPaise: input.creditLimitPaise } : {}),
    },
  });
}

export async function listCustomers(
  scope: TenantScope,
  filters: { search?: string; withDueOnly?: boolean; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
  const search = filters.search?.trim();
  const where = {
    businessId: scope.businessId,
    isActive: true,
    ...(filters.withDueOnly ? { balancePaise: { gt: 0 } } : {}),
    ...(search ? { OR: [{ name: { contains: search } }, { phone: { contains: search } }] } : {}),
  };
  const [items, total, outstanding] = await Promise.all([
    prisma.customer.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.customer.count({ where }),
    prisma.customer.aggregate({
      where: { businessId: scope.businessId, isActive: true, balancePaise: { gt: 0 } },
      _sum: { balancePaise: true },
      _count: true,
    }),
  ]);
  return {
    items,
    total,
    page,
    pageSize,
    summary: {
      outstandingPaise: outstanding._sum.balancePaise ?? 0,
      withDueCount: outstanding._count,
    },
  };
}

export async function getCustomerDetail(scope: TenantScope, id: string) {
  const customer = await prisma.customer.findFirst({
    where: { id, businessId: scope.businessId },
    include: {
      sales: { orderBy: { saleDate: 'desc' }, take: 20, select: { id: true, invoiceNumber: true, saleDate: true, totalPaise: true, duePaise: true, status: true } },
      payments: { orderBy: { createdAt: 'desc' }, take: 20 },
      salesReturns: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  });
  if (!customer) throw notFound('Customer');

  const totals = await prisma.sale.aggregate({
    where: { businessId: scope.businessId, customerId: id, status: 'COMPLETED' },
    _sum: { totalPaise: true, paidPaise: true },
    _count: true,
  });

  return {
    ...customer,
    summary: {
      billCount: totals._count,
      totalPurchasedPaise: totals._sum.totalPaise ?? 0,
      totalPaidPaise: totals._sum.paidPaise ?? 0,
      outstandingPaise: customer.balancePaise,
    },
  };
}

export async function recordCustomerPayment(
  scope: TenantScope,
  input: { customerId: string; amountPaise: number; method?: PaymentMethod; reference?: string; note?: string; saleId?: string },
) {
  if (input.amountPaise <= 0) throw badRequest('Enter an amount more than zero.');
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { id: input.customerId, businessId: scope.businessId },
    });
    if (!customer) throw notFound('Customer');

    const balanceAfter = customer.balancePaise - input.amountPaise;
    await tx.customer.update({ where: { id: customer.id }, data: { balancePaise: balanceAfter } });

    const payment = await tx.customerPayment.create({
      data: {
        businessId: scope.businessId,
        customerId: customer.id,
        amountPaise: input.amountPaise,
        method: input.method ?? 'CASH',
        reference: input.reference ?? null,
        note: input.note ?? null,
        saleId: input.saleId ?? null,
        balanceAfterPaise: balanceAfter,
        userId: scope.userId || null,
      },
    });

    // Money handed over at the counter settles bills oldest first unless the
    // owner pointed at one, so a customer's bill list agrees with their balance.
    const unpaidBills = input.saleId
      ? await tx.sale.findMany({ where: { id: input.saleId, businessId: scope.businessId } })
      : await tx.sale.findMany({
          where: {
            businessId: scope.businessId,
            customerId: customer.id,
            status: 'COMPLETED',
            duePaise: { gt: 0 },
          },
          orderBy: { saleDate: 'asc' },
        });

    let unallocated = input.amountPaise;
    const settledBills: string[] = [];
    for (const sale of unpaidBills) {
      if (unallocated <= 0) break;
      const applied = Math.min(sale.duePaise, unallocated);
      if (applied <= 0) continue;
      await tx.sale.update({
        where: { id: sale.id },
        data: { paidPaise: sale.paidPaise + applied, duePaise: sale.duePaise - applied },
      });
      unallocated -= applied;
      settledBills.push(sale.invoiceNumber);
    }

    await recordAudit(tx, scope, {
      action: 'CUSTOMER_PAYMENT',
      entityType: 'Customer',
      entityId: customer.id,
      before: { balancePaise: customer.balancePaise },
      after: { balancePaise: balanceAfter, amountPaise: input.amountPaise, settledBills },
    });

    return { ...payment, settledBills };
  }, txOptions);
}

export async function createSupplier(scope: TenantScope, input: PartyInput) {
  if (!input.name.trim()) throw badRequest('Please enter the supplier name.');
  return prisma.supplier.create({
    data: {
      businessId: scope.businessId,
      name: input.name.trim(),
      normalizedName: normalizeName(input.name),
      phone: input.phone?.trim() || null,
      email: input.email ?? null,
      address: input.address ?? null,
      gstin: input.gstin ?? null,
      balancePaise: input.openingBalancePaise ?? 0,
    },
  });
}

export async function updateSupplier(scope: TenantScope, id: string, input: Partial<PartyInput>) {
  const existing = await prisma.supplier.findFirst({ where: { id, businessId: scope.businessId } });
  if (!existing) throw notFound('Supplier');
  return prisma.supplier.update({
    where: { id },
    data: {
      ...(input.name ? { name: input.name.trim(), normalizedName: normalizeName(input.name) } : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.gstin !== undefined ? { gstin: input.gstin } : {}),
    },
  });
}

export async function listSuppliers(
  scope: TenantScope,
  filters: { search?: string; withDueOnly?: boolean; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
  const search = filters.search?.trim();
  const where = {
    businessId: scope.businessId,
    isActive: true,
    ...(filters.withDueOnly ? { balancePaise: { gt: 0 } } : {}),
    ...(search ? { OR: [{ name: { contains: search } }, { phone: { contains: search } }] } : {}),
  };
  const [items, total, outstanding] = await Promise.all([
    prisma.supplier.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.supplier.count({ where }),
    prisma.supplier.aggregate({
      where: { businessId: scope.businessId, isActive: true, balancePaise: { gt: 0 } },
      _sum: { balancePaise: true },
      _count: true,
    }),
  ]);
  return {
    items,
    total,
    page,
    pageSize,
    summary: {
      outstandingPaise: outstanding._sum.balancePaise ?? 0,
      withDueCount: outstanding._count,
    },
  };
}

export async function getSupplierDetail(scope: TenantScope, id: string) {
  const supplier = await prisma.supplier.findFirst({
    where: { id, businessId: scope.businessId },
    include: {
      purchases: { orderBy: { purchaseDate: 'desc' }, take: 20, select: { id: true, invoiceNumber: true, purchaseDate: true, totalPaise: true, duePaise: true, status: true } },
      payments: { orderBy: { createdAt: 'desc' }, take: 20 },
      purchaseReturns: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  });
  if (!supplier) throw notFound('Supplier');

  const totals = await prisma.purchase.aggregate({
    where: { businessId: scope.businessId, supplierId: id, status: 'COMPLETED' },
    _sum: { totalPaise: true, paidPaise: true },
    _count: true,
  });

  return {
    ...supplier,
    summary: {
      purchaseCount: totals._count,
      totalPurchasedPaise: totals._sum.totalPaise ?? 0,
      totalPaidPaise: totals._sum.paidPaise ?? 0,
      outstandingPaise: supplier.balancePaise,
    },
  };
}

export async function recordSupplierPayment(
  scope: TenantScope,
  input: { supplierId: string; amountPaise: number; method?: PaymentMethod; reference?: string; note?: string; purchaseId?: string },
) {
  if (input.amountPaise <= 0) throw badRequest('Enter an amount more than zero.');
  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({
      where: { id: input.supplierId, businessId: scope.businessId },
    });
    if (!supplier) throw notFound('Supplier');

    const balanceAfter = supplier.balancePaise - input.amountPaise;
    await tx.supplier.update({ where: { id: supplier.id }, data: { balancePaise: balanceAfter } });

    const payment = await tx.supplierPayment.create({
      data: {
        businessId: scope.businessId,
        supplierId: supplier.id,
        amountPaise: input.amountPaise,
        method: input.method ?? 'CASH',
        reference: input.reference ?? null,
        note: input.note ?? null,
        purchaseId: input.purchaseId ?? null,
        balanceAfterPaise: balanceAfter,
        userId: scope.userId || null,
      },
    });

    const unpaidPurchases = input.purchaseId
      ? await tx.purchase.findMany({ where: { id: input.purchaseId, businessId: scope.businessId } })
      : await tx.purchase.findMany({
          where: {
            businessId: scope.businessId,
            supplierId: supplier.id,
            status: 'COMPLETED',
            duePaise: { gt: 0 },
          },
          orderBy: { purchaseDate: 'asc' },
        });

    let unallocated = input.amountPaise;
    const settledPurchases: string[] = [];
    for (const purchase of unpaidPurchases) {
      if (unallocated <= 0) break;
      const applied = Math.min(purchase.duePaise, unallocated);
      if (applied <= 0) continue;
      await tx.purchase.update({
        where: { id: purchase.id },
        data: { paidPaise: purchase.paidPaise + applied, duePaise: purchase.duePaise - applied },
      });
      unallocated -= applied;
      settledPurchases.push(purchase.invoiceNumber ?? purchase.id);
    }

    await recordAudit(tx, scope, {
      action: 'SUPPLIER_PAYMENT',
      entityType: 'Supplier',
      entityId: supplier.id,
      before: { balancePaise: supplier.balancePaise },
      after: { balancePaise: balanceAfter, amountPaise: input.amountPaise, settledPurchases },
    });

    return { ...payment, settledPurchases };
  }, txOptions);
}

/** Used by the scanner to attach an extracted supplier name to a real record. */
export async function findOrCreateSupplierByName(scope: TenantScope, name: string) {
  const normalized = normalizeName(name);
  const existing = await prisma.supplier.findFirst({
    where: { businessId: scope.businessId, OR: [{ normalizedName: normalized }, { name }] },
  });
  if (existing) return existing;
  return createSupplier(scope, { name });
}
