import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import type { TenantScope } from '../db/tenant.js';
import { toPaise } from '../domain/money.js';

let app: Express | undefined;

export function testApp(): Express {
  if (!app) app = createApp();
  return app;
}

let counter = 0;
// Test files share one SQLite database, so the number has to be unique across
// files as well as within one: a repeated phone would make login ambiguous.
const phoneSeed = Math.floor(Math.random() * 900) + 100;
const uniquePhone = () => `9${phoneSeed}${String(100000 + (counter += 1)).slice(0, 6)}`;

export interface TestShop {
  businessId: string;
  ownerId: string;
  token: string;
  scope: TenantScope;
  phone: string;
}

/** Registers an isolated shop; every test gets its own tenant. */
export async function createTestShop(
  businessType = 'KIRANA',
  overrides: Partial<{ pricesIncludeTax: boolean; taxEnabled: boolean; allowNegativeStock: boolean }> = {},
): Promise<TestShop> {
  const phone = uniquePhone();
  const response = await request(testApp())
    .post('/api/auth/register')
    .send({
      businessName: `Test Shop ${counter}`,
      ownerName: 'Test Owner',
      phone,
      businessType,
      pin: '1234',
      ...(overrides.pricesIncludeTax !== undefined ? { pricesIncludeTax: overrides.pricesIncludeTax } : {}),
      ...(overrides.taxEnabled !== undefined ? { taxEnabled: overrides.taxEnabled } : {}),
    })
    .expect(201);

  const businessId = response.body.business.id as string;
  const ownerId = response.body.user.id as string;

  if (overrides.allowNegativeStock !== undefined) {
    await prisma.businessSettings.update({
      where: { businessId },
      data: { allowNegativeStock: overrides.allowNegativeStock },
    });
  }

  return {
    businessId,
    ownerId,
    token: response.body.accessToken as string,
    scope: { businessId, userId: ownerId, role: 'OWNER' },
    phone,
  };
}

export async function addStaff(
  shop: TestShop,
  role: 'MANAGER' | 'CASHIER',
): Promise<{ token: string; userId: string; phone: string }> {
  const phone = uniquePhone();
  const created = await request(testApp())
    .post('/api/auth/users')
    .set('Authorization', `Bearer ${shop.token}`)
    .send({ name: `${role} user`, phone, pin: '4321', role })
    .expect(201);

  const login = await request(testApp())
    .post('/api/auth/login')
    .send({ phone, pin: '4321', businessId: shop.businessId })
    .expect(200);

  return { token: login.body.accessToken, userId: created.body.id, phone };
}

export interface TestProductInput {
  name: string;
  purchase?: number;
  selling?: number;
  mrp?: number;
  stock?: number;
  minStock?: number;
  barcode?: string;
  unitCode?: string;
  taxRate?: number;
  trackBatch?: boolean;
}

/** Creates a product with opening stock and returns its default variant id. */
export async function createTestProduct(shop: TestShop, input: TestProductInput) {
  let taxId: string | undefined;
  if (input.taxRate !== undefined) {
    const tax = await prisma.tax.findFirst({ where: { businessId: shop.businessId, rate: input.taxRate } });
    taxId =
      tax?.id ??
      (await prisma.tax.create({
        data: { businessId: shop.businessId, name: `GST ${input.taxRate}%`, rate: input.taxRate },
      })).id;
  }

  const response = await request(testApp())
    .post('/api/products')
    .set('Authorization', `Bearer ${shop.token}`)
    .send({
      name: input.name,
      unitCode: input.unitCode ?? 'PCS',
      barcode: input.barcode,
      purchasePricePaise: toPaise(input.purchase ?? 10),
      sellingPricePaise: toPaise(input.selling ?? 15),
      mrpPaise: toPaise(input.mrp ?? input.selling ?? 15),
      minStock: input.minStock ?? 0,
      openingStock: input.stock ?? 0,
      trackBatch: input.trackBatch ?? false,
      trackExpiry: input.trackBatch ?? false,
      taxId,
      ignoreDuplicateWarning: true,
    })
    .expect(201);

  return {
    productId: response.body.id as string,
    variantId: response.body.variants[0].id as string,
    body: response.body,
  };
}

export const auth = (shop: TestShop | { token: string }) => ({ Authorization: `Bearer ${shop.token}` });

export async function stockOf(variantId: string): Promise<number> {
  const inventory = await prisma.inventory.findFirst({ where: { variantId } });
  return inventory?.quantity ?? 0;
}

export const api = () => request(testApp());
