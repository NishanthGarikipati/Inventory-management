import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db/prisma.js';
import { registerBusiness, createStaffUser } from '../services/auth.service.js';
import { createProduct } from '../services/product.service.js';
import { createCustomer, createSupplier } from '../services/party.service.js';
import { createPurchase } from '../services/purchase.service.js';
import { createSale } from '../services/sale.service.js';
import { createExpense } from '../services/expense.service.js';
import { createRecipe, recordProduction } from '../services/production.service.js';
import { createSalesReturn } from '../services/returns.service.js';
import { uploadScan, processScan } from '../services/scanner/pipeline.js';
import { refreshBusinessAlerts } from '../services/notification.service.js';
import { toPaise } from '../domain/money.js';
import type { TenantScope } from '../db/tenant.js';
import { SEED_BUSINESSES, type SeedProduct } from './catalogues.js';
import { SAMPLE_DOCUMENTS } from './sampleDocuments.js';
import { renderTextPng } from './textImage.js';
import { BUSINESS_TYPE_TEMPLATES } from '../domain/businessTypes.js';
import { ROLE_DESCRIPTIONS, ROLE_PERMISSIONS, PERMISSIONS } from '../domain/permissions.js';
import { USER_ROLES } from '../domain/enums.js';

const DEMO_PIN = '1234';
const SAMPLES_DIR = path.resolve(process.cwd(), 'samples');

/**
 * Builds a complete demo shop for every supported industry: staff, suppliers,
 * customers, catalogue with opening stock, two weeks of sales, purchases,
 * expenses, returns, production runs and a smart scan waiting for approval.
 */
async function main() {
  const fresh = process.argv.includes('--fresh');
  const only = process.argv.find((arg) => arg.startsWith('--only='))?.split('=')[1];

  if (fresh) {
    console.log('Clearing existing data...');
    await prisma.business.deleteMany({});
  }

  await seedGlobalCatalogues();
  await writeSampleImages();

  const definitions = only
    ? SEED_BUSINESSES.filter((b) => b.type === only.toUpperCase())
    : SEED_BUSINESSES;

  for (const definition of definitions) {
    const existing = await prisma.business.findFirst({ where: { name: definition.name } });
    if (existing) {
      console.log(`- ${definition.name} already exists, skipping`);
      continue;
    }

    console.log(`- Creating ${definition.name} (${definition.type})`);
    const registered = await registerBusiness({
      businessName: definition.name,
      ownerName: definition.ownerName,
      phone: definition.phone,
      address: definition.address,
      businessType: definition.type,
      pin: DEMO_PIN,
    });

    const scope: TenantScope = {
      businessId: registered.business.id,
      userId: registered.user.id,
      role: 'OWNER',
    };

    await createStaffUser(scope.businessId, {
      name: 'Store Manager',
      phone: `${definition.phone.slice(0, 6)}1111`,
      pin: '2345',
      role: 'MANAGER',
    });
    await createStaffUser(scope.businessId, {
      name: 'Counter Staff',
      phone: `${definition.phone.slice(0, 6)}2222`,
      pin: '3456',
      role: 'CASHIER',
    });

    const suppliers = [];
    for (const supplier of definition.suppliers) {
      suppliers.push(await createSupplier(scope, { name: supplier.name, phone: supplier.phone, address: supplier.address }));
    }

    // Credit limits scale with what this shop sells: ₹20,000 is generous for a
    // kirana store and far too small for an electronics showroom.
    const dearest = Math.max(...definition.products.map((product) => product.selling));
    const creditLimitPaise = toPaise(Math.max(20000, Math.ceil((dearest * 4) / 1000) * 1000));

    const customers = [];
    for (const customer of definition.customers) {
      customers.push(await createCustomer(scope, { name: customer.name, phone: customer.phone, creditLimitPaise }));
    }

    // The demo shop "opened" two weeks ago, so opening stock has to cover the
    // sales that are about to be replayed. Planning the bills first means the
    // closing stock lands on the level the catalogue describes - including the
    // items that are deliberately low or out of stock.
    const salesPlan = planSales(definition.products);
    const variantByProductName = new Map<string, { variantId: string; sellingPaise: number; name: string }>();
    for (const [index, product] of definition.products.entries()) {
      const created = await createProductFromSeed(
        scope,
        product,
        suppliers[index % suppliers.length]?.id,
        salesPlan.demand,
      );
      for (const variant of created.variants) {
        variantByProductName.set(
          variant.isDefault ? product.name : `${product.name} - ${variant.name}`,
          { variantId: variant.id, sellingPaise: variant.sellingPricePaise, name: product.name },
        );
      }
    }

    if (definition.recipes?.length) {
      for (const recipe of definition.recipes) {
        const productVariant = variantByProductName.get(recipe.product);
        if (!productVariant) continue;
        const product = await prisma.productVariant.findUniqueOrThrow({
          where: { id: productVariant.variantId },
          select: { productId: true },
        });
        const created = await createRecipe(scope, {
          productId: product.productId,
          name: recipe.name,
          autoConsumeOnSale: recipe.autoConsumeOnSale,
          items: recipe.items
            .map((item) => ({
              variantId: variantByProductName.get(item.product)?.variantId ?? '',
              quantity: item.quantity,
            }))
            .filter((item) => item.variantId),
        });
        if (!recipe.autoConsumeOnSale) {
          await recordProduction(scope, {
            recipeId: created.id,
            quantity: 2,
            batchLabel: `PROD-${new Date().toISOString().slice(5, 10).replace('-', '')}`,
            expiryDate: new Date(Date.now() + 3 * 86400_000),
          });
        }
      }
    }

    await seedPurchases(scope, definition.products, variantByProductName, suppliers);
    await seedSales(scope, salesPlan.bills, variantByProductName, customers);
    await seedExpenses(scope);
    await seedScan(scope, definition.type);
    await refreshBusinessAlerts(scope.businessId);
  }

  const businesses = await prisma.business.findMany({ select: { name: true, phone: true, businessType: true } });
  console.log('\nDemo shops ready. Sign in with PIN 1234:');
  for (const business of businesses) {
    console.log(`  ${business.phone}  ${business.name} (${business.businessType})`);
  }
  console.log(`\nSample scanner images written to ${SAMPLES_DIR}`);
}

async function createProductFromSeed(
  scope: TenantScope,
  product: SeedProduct,
  supplierId?: string,
  demand: Map<string, number> = new Map(),
) {
  const expiry = product.batch ? new Date(Date.now() + product.batch.expiryMonths * 30 * 86400_000) : null;
  const openingFor = (key: string, base: number) => Math.round((base + (demand.get(key) ?? 0)) * 1000) / 1000;

  const created = await createProduct(scope, {
    name: product.name,
    categoryName: product.category,
    brandName: product.brand,
    unitCode: product.unit,
    supplierId: supplierId ?? null,
    barcode: product.barcode ?? null,
    purchasePricePaise: toPaise(product.purchase),
    sellingPricePaise: toPaise(product.selling),
    mrpPaise: toPaise(product.mrp ?? product.selling),
    minStock: product.minStock,
    openingStock: product.variants?.length ? 0 : openingFor(product.name, product.stock),
    trackBatch: Boolean(product.batch),
    trackExpiry: Boolean(product.batch),
    trackSerial: Boolean(product.serials?.length),
    attributes: product.attributes,
    ignoreDuplicateWarning: true,
    variants: product.variants?.map((variant) => ({
      name: variant.name,
      options: variant.options,
      purchasePricePaise: toPaise(variant.purchase ?? product.purchase),
      sellingPricePaise: toPaise(variant.selling ?? product.selling),
      mrpPaise: toPaise(product.mrp ?? product.selling),
      minStock: product.minStock,
      openingStock: openingFor(`${product.name} - ${variant.name}`, variant.stock),
    })),
  });

  if (product.batch && expiry) {
    const variant = created.variants[0];
    await prisma.batch.create({
      data: {
        businessId: scope.businessId,
        variantId: variant.id,
        batchNumber: product.batch.number,
        expiryDate: expiry,
        quantity: product.stock,
        costPaise: toPaise(product.purchase),
        mrpPaise: toPaise(product.mrp ?? product.selling),
      },
    });
  }

  if (product.serials?.length) {
    for (const serial of product.serials) {
      await prisma.serialItem.create({
        data: {
          businessId: scope.businessId,
          variantId: created.variants[0].id,
          serial,
          imei: serial.startsWith('IMEI') ? serial.slice(4) : null,
          status: 'IN_STOCK',
          warrantyMonths: 12,
        },
      });
    }
  }

  return created;
}

async function seedPurchases(
  scope: TenantScope,
  products: SeedProduct[],
  variants: Map<string, { variantId: string; sellingPaise: number }>,
  suppliers: Array<{ id: string }>,
) {
  const stocked = products.filter((p) => !p.variants?.length && p.purchase > 0).slice(0, 6);
  if (!stocked.length || !suppliers.length) return;

  for (let index = 0; index < 2; index += 1) {
    const supplier = suppliers[index % suppliers.length];
    const items = stocked.slice(index * 3, index * 3 + 3).map((product) => ({
      variantId: variants.get(product.name)!.variantId,
      quantity: Math.max(2, Math.round(product.minStock || 5)),
      unitCostPaise: toPaise(product.purchase),
    }));
    if (!items.length) continue;

    const totalPaise = items.reduce((sum, item) => sum + item.unitCostPaise * item.quantity, 0);
    await createPurchase(scope, {
      supplierId: supplier.id,
      invoiceNumber: `SUP-${1000 + index}`,
      purchaseDate: new Date(Date.now() - (index + 1) * 3 * 86400_000),
      items,
      // The second purchase is left partly unpaid so supplier dues show up.
      payments: index === 0 ? [{ method: 'CASH', amountPaise: totalPaise }] : [{ method: 'UPI', amountPaise: Math.round(totalPaise / 2) }],
    });
  }
}

interface PlannedBill {
  daysAgo: number;
  hour: number;
  lines: Array<{ key: string; quantity: number }>;
  onCredit: boolean;
  withCustomer: boolean;
  customerIndex: number;
  method: 'CASH' | 'UPI' | 'CARD';
}

/** Deterministic so re-seeding produces the same demo shop every time. */
function planSales(products: SeedProduct[]): { bills: PlannedBill[]; demand: Map<string, number> } {
  const sellable: Array<{ key: string; unit: string }> = [];
  for (const product of products) {
    if (product.isIngredient) continue;
    if (product.variants?.length) {
      for (const variant of product.variants) {
        sellable.push({ key: `${product.name} - ${variant.name}`, unit: product.unit });
      }
    } else {
      sellable.push({ key: product.name, unit: product.unit });
    }
  }

  const bills: PlannedBill[] = [];
  const demand = new Map<string, number>();
  if (!sellable.length) return { bills, demand };

  const methods = ['CASH', 'UPI', 'CARD'] as const;
  let seed = 7;
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  for (let daysAgo = 13; daysAgo >= 0; daysAgo -= 1) {
    const billCount = 2 + Math.floor(random() * 4);
    for (let bill = 0; bill < billCount; bill += 1) {
      const lineCount = 1 + Math.floor(random() * 3);
      const lines: PlannedBill['lines'] = [];
      const used = new Set<string>();
      for (let line = 0; line < lineCount; line += 1) {
        const pick = sellable[Math.floor(random() * sellable.length)];
        if (used.has(pick.key)) continue;
        used.add(pick.key);
        const loose = pick.unit === 'KG' || pick.unit === 'L';
        const quantity = loose ? 0.5 + Math.round(random() * 2) : 1 + Math.floor(random() * 3);
        lines.push({ key: pick.key, quantity });
        demand.set(pick.key, Math.round(((demand.get(pick.key) ?? 0) + quantity) * 1000) / 1000);
      }
      if (!lines.length) continue;

      bills.push({
        daysAgo,
        hour: 9 + (bill % 11),
        lines,
        onCredit: random() > 0.85,
        withCustomer: random() > 0.7,
        customerIndex: Math.floor(random() * 5),
        method: methods[Math.floor(random() * methods.length)],
      });
    }
  }

  return { bills, demand };
}

async function seedSales(
  scope: TenantScope,
  bills: PlannedBill[],
  variants: Map<string, { variantId: string; sellingPaise: number }>,
  customers: Array<{ id: string }>,
) {
  for (const bill of bills) {
    const items = bill.lines
      .map((line) => ({ variant: variants.get(line.key), quantity: line.quantity }))
      .filter((line): line is { variant: { variantId: string; sellingPaise: number }; quantity: number } =>
        Boolean(line.variant),
      );
    if (!items.length) continue;

    const saleDate = new Date(Date.now() - bill.daysAgo * 86400_000);
    saleDate.setHours(bill.hour, 15, 0, 0);

    const estimate = items.reduce((sum, item) => sum + item.variant.sellingPaise * item.quantity, 0);
    // Prices are tax inclusive and bills round to the rupee, so this is the
    // amount the customer actually hands over.
    const billPaise = Math.round(estimate / 100) * 100;
    const customerId = bill.onCredit || bill.withCustomer ? customers[bill.customerIndex % customers.length]?.id : null;

    await createSale(scope, {
      customerId: customerId ?? null,
      items: items.map((item) => ({ variantId: item.variant.variantId, quantity: item.quantity })),
      saleDate,
      payments:
        bill.onCredit && customerId
          ? [{ method: 'CASH', amountPaise: Math.round(billPaise / 2 / 100) * 100 }]
          : [{ method: bill.method, amountPaise: billPaise }],
    });
  }

  // One sale return so the returns screens and reports have data.
  const lastSale = await prisma.sale.findFirst({
    where: { businessId: scope.businessId, status: 'COMPLETED' },
    include: { items: true },
    orderBy: { saleDate: 'desc' },
  });
  if (lastSale?.items.length) {
    const item = lastSale.items[0];
    await createSalesReturn(scope, {
      saleId: lastSale.id,
      reason: 'Customer changed mind',
      refundMethod: 'CASH',
      items: [{ saleItemId: item.id, quantity: Math.min(1, item.quantity) }],
    }).catch(() => undefined);
  }
}

async function seedExpenses(scope: TenantScope) {
  const expenses = [
    { categoryName: 'Rent', amount: 15000, daysAgo: 12 },
    { categoryName: 'Electricity', amount: 2400, daysAgo: 6 },
    { categoryName: 'Salary', amount: 12000, daysAgo: 5 },
    { categoryName: 'Transport', amount: 850, daysAgo: 2 },
    { categoryName: 'Packaging', amount: 600, daysAgo: 0 },
  ];
  for (const expense of expenses) {
    await createExpense(scope, {
      categoryName: expense.categoryName,
      amountPaise: toPaise(expense.amount),
      method: 'CASH',
      description: `${expense.categoryName} for the shop`,
      expenseDate: new Date(Date.now() - expense.daysAgo * 86400_000),
    });
  }
}

/** Leaves one scanned invoice sitting on the review screen, as in real use. */
async function seedScan(scope: TenantScope, businessType: string) {
  const document =
    businessType === 'MEDICAL'
      ? SAMPLE_DOCUMENTS.find((d) => d.key === 'invoice-pharma')!
      : SAMPLE_DOCUMENTS.find((d) => d.key === 'invoice-abc-distributors')!;

  const image = renderTextPng(document.lines, { scale: 4, noise: 0.01 });
  const { scan } = await uploadScan(scope, {
    buffer: image,
    mimeType: 'image/png',
    scanType: document.scanType,
    ocrText: document.lines.join('\n'),
    barcodes: document.barcodes,
  });
  await processScan(scope, scan.id);
}

async function seedGlobalCatalogues() {
  for (const template of BUSINESS_TYPE_TEMPLATES) {
    await prisma.businessType.upsert({
      where: { code: template.code },
      create: {
        code: template.code,
        name: template.name,
        description: template.description,
        icon: template.icon,
        sortOrder: template.sortOrder,
        config: JSON.stringify({
          features: template.features,
          attributes: template.attributes,
          units: template.units,
          categories: template.categories,
          dashboardHighlights: template.dashboardHighlights,
        }),
      },
      update: {},
    });
  }

  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { code },
      create: { code, description, module: code.split(':')[0] },
      update: { description },
    });
  }

  for (const role of USER_ROLES) {
    await prisma.role.upsert({
      where: { code: role },
      create: { code: role, name: ROLE_DESCRIPTIONS[role].name, description: ROLE_DESCRIPTIONS[role].description },
      update: {},
    });
    for (const permission of ROLE_PERMISSIONS[role]) {
      await prisma.rolePermission.upsert({
        where: { roleCode_permissionCode: { roleCode: role, permissionCode: permission } },
        create: { roleCode: role, permissionCode: permission },
        update: {},
      });
    }
  }
}

async function writeSampleImages() {
  await fs.mkdir(SAMPLES_DIR, { recursive: true });
  for (const document of SAMPLE_DOCUMENTS) {
    const png = renderTextPng(document.lines, { scale: 4, noise: 0.01 });
    await fs.writeFile(path.join(SAMPLES_DIR, `${document.key}.png`), png);
    await fs.writeFile(path.join(SAMPLES_DIR, `${document.key}.txt`), document.lines.join('\n'));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
