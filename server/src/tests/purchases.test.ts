import { describe, expect, it } from 'vitest';
import { api, auth, createTestProduct, createTestShop, stockOf } from './helpers.js';
import { prisma } from '../db/prisma.js';
import { toPaise } from '../domain/money.js';

let supplierPhone = 9876500000;

async function supplierFor(shop: Awaited<ReturnType<typeof createTestShop>>, name = 'ABC Distributors') {
  const response = await api()
    .post('/api/suppliers')
    .set(auth(shop))
    .send({ name, phone: String((supplierPhone += 1)) })
    .expect(201);
  return response.body.id as string;
}

describe('purchases and suppliers', () => {
  it('brings stock in at the invoice cost and records the supplier due', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const supplierId = await supplierFor(shop);
    const rice = await createTestProduct(shop, { name: 'Rice 5KG', stock: 0, purchase: 300 });
    const sugar = await createTestProduct(shop, { name: 'Sugar 1KG', stock: 0, purchase: 45 });

    const purchase = await api()
      .post('/api/purchases')
      .set(auth(shop))
      .send({
        supplierId,
        invoiceNumber: 'INV-12345',
        items: [
          { variantId: rice.variantId, quantity: 20, unitCostPaise: toPaise(300) },
          { variantId: sugar.variantId, quantity: 30, unitCostPaise: toPaise(45) },
        ],
        payments: [{ method: 'CASH', amountPaise: toPaise(2000) }],
      })
      .expect(201);

    expect(purchase.body.totalPaise).toBe(toPaise(7350));
    expect(purchase.body.paidPaise).toBe(toPaise(2000));
    expect(purchase.body.duePaise).toBe(toPaise(5350));

    expect(await stockOf(rice.variantId)).toBe(20);
    expect(await stockOf(sugar.variantId)).toBe(30);

    const supplier = await api().get(`/api/suppliers/${supplierId}`).set(auth(shop)).expect(200);
    expect(supplier.body.balancePaise).toBe(toPaise(5350));
    expect(supplier.body.summary.totalPurchasedPaise).toBe(toPaise(7350));
  });

  it('writes a PURCHASE line into the stock ledger for each item', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const supplierId = await supplierFor(shop);
    const { variantId } = await createTestProduct(shop, { name: 'Oil 1L', stock: 0 });

    await api()
      .post('/api/purchases')
      .set(auth(shop))
      .send({ supplierId, items: [{ variantId, quantity: 15, unitCostPaise: toPaise(110) }] })
      .expect(201);

    const ledger = await api().get(`/api/inventory/ledger/${variantId}`).set(auth(shop)).expect(200);
    expect(ledger.body.transactions[0]).toMatchObject({
      type: 'PURCHASE',
      quantity: 15,
      previousStock: 0,
      newStock: 15,
      source: 'MANUAL',
    });
  });

  it('adds tax on the purchase when the shop works tax exclusive', async () => {
    const shop = await createTestShop('KIRANA', { pricesIncludeTax: false });
    const supplierId = await supplierFor(shop);
    const { variantId } = await createTestProduct(shop, { name: 'Detergent', stock: 0 });

    const purchase = await api()
      .post('/api/purchases')
      .set(auth(shop))
      .send({ supplierId, items: [{ variantId, quantity: 10, unitCostPaise: toPaise(100), taxRate: 18 }] })
      .expect(201);

    expect(purchase.body.subtotalPaise).toBe(toPaise(1000));
    expect(purchase.body.taxPaise).toBe(toPaise(180));
    expect(purchase.body.totalPaise).toBe(toPaise(1180));
  });

  it('creates a batch with its expiry date', async () => {
    const shop = await createTestShop('MEDICAL', { taxEnabled: false });
    const supplierId = await supplierFor(shop, 'Medico Agencies');
    const { variantId } = await createTestProduct(shop, { name: 'Amoxicillin 500', trackBatch: true });
    const expiry = new Date(Date.now() + 200 * 86400_000);

    await api()
      .post('/api/purchases')
      .set(auth(shop))
      .send({
        supplierId,
        items: [
          {
            variantId,
            quantity: 40,
            unitCostPaise: toPaise(8),
            batchNumber: 'P123',
            expiryDate: expiry,
            mrpPaise: toPaise(12),
          },
        ],
      })
      .expect(201);

    const batches = await api().get(`/api/inventory/batches/${variantId}`).set(auth(shop)).expect(200);
    expect(batches.body.batches).toHaveLength(1);
    expect(batches.body.batches[0]).toMatchObject({ batchNumber: 'P123', quantity: 40, mrpPaise: toPaise(12) });
    expect(new Date(batches.body.batches[0].expiryDate).toDateString()).toBe(expiry.toDateString());
  });

  it('can update the selling price from the purchase screen', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const supplierId = await supplierFor(shop);
    const { variantId } = await createTestProduct(shop, { name: 'Tea 500G', stock: 0, selling: 240 });

    await api()
      .post('/api/purchases')
      .set(auth(shop))
      .send({
        supplierId,
        items: [
          {
            variantId,
            quantity: 5,
            unitCostPaise: toPaise(210),
            updateSellingPricePaise: toPaise(260),
            mrpPaise: toPaise(275),
          },
        ],
      })
      .expect(201);

    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(variant.sellingPricePaise).toBe(toPaise(260));
    expect(variant.mrpPaise).toBe(toPaise(275));
  });

  it('cancels a purchase, takes the stock back out and clears the due', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const supplierId = await supplierFor(shop);
    const { variantId } = await createTestProduct(shop, { name: 'Soap Box', stock: 0 });

    const purchase = await api()
      .post('/api/purchases')
      .set(auth(shop))
      .send({ supplierId, items: [{ variantId, quantity: 12, unitCostPaise: toPaise(30) }] })
      .expect(201);

    expect(await stockOf(variantId)).toBe(12);

    const cancelled = await api()
      .post(`/api/purchases/${purchase.body.id}/cancel`)
      .set(auth(shop))
      .send({ reason: 'Wrong invoice entered' })
      .expect(200);

    expect(cancelled.body.status).toBe('CANCELLED');
    expect(await stockOf(variantId)).toBe(0);

    const supplier = await api().get(`/api/suppliers/${supplierId}`).set(auth(shop)).expect(200);
    expect(supplier.body.balancePaise).toBe(0);
  });

  it('refuses to cancel a purchase whose stock has already been sold', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const supplierId = await supplierFor(shop);
    const { variantId } = await createTestProduct(shop, { name: 'Cold Drink', stock: 0, selling: 40 });

    const purchase = await api()
      .post('/api/purchases')
      .set(auth(shop))
      .send({ supplierId, items: [{ variantId, quantity: 6, unitCostPaise: toPaise(25) }] })
      .expect(201);

    await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 6 }], payments: [{ method: 'CASH', amountPaise: toPaise(240) }] })
      .expect(201);

    const response = await api()
      .post(`/api/purchases/${purchase.body.id}/cancel`)
      .set(auth(shop))
      .send({ reason: 'Wrong entry' })
      .expect(409);

    expect(response.body.error.message).toBeTruthy();
    expect(await stockOf(variantId)).toBe(0);
  });

  it('settles supplier bills oldest first when a payment is made', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const supplierId = await supplierFor(shop);
    const { variantId } = await createTestProduct(shop, { name: 'Flour Bag', stock: 0 });

    const first = await api()
      .post('/api/purchases')
      .set(auth(shop))
      .send({
        supplierId,
        invoiceNumber: 'OLD-1',
        purchaseDate: new Date(Date.now() - 4 * 86400_000),
        items: [{ variantId, quantity: 10, unitCostPaise: toPaise(100) }],
      })
      .expect(201);
    const second = await api()
      .post('/api/purchases')
      .set(auth(shop))
      .send({
        supplierId,
        invoiceNumber: 'NEW-1',
        items: [{ variantId, quantity: 5, unitCostPaise: toPaise(100) }],
      })
      .expect(201);

    await api()
      .post('/api/payments/supplier')
      .set(auth(shop))
      .send({ supplierId, amountPaise: toPaise(1200), method: 'UPI', reference: 'NEFT-1' })
      .expect(201);

    const supplier = await api().get(`/api/suppliers/${supplierId}`).set(auth(shop)).expect(200);
    expect(supplier.body.balancePaise).toBe(toPaise(300));

    const oldBill = await api().get(`/api/purchases/${first.body.id}`).set(auth(shop)).expect(200);
    const newBill = await api().get(`/api/purchases/${second.body.id}`).set(auth(shop)).expect(200);
    expect(oldBill.body.duePaise).toBe(0);
    expect(newBill.body.duePaise).toBe(toPaise(300));
  });

  it('lists suppliers that still have money owing', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const owing = await supplierFor(shop, 'Owed Traders');
    await supplierFor(shop, 'Settled Traders');
    const { variantId } = await createTestProduct(shop, { name: 'Ghee Tin', stock: 0 });

    await api()
      .post('/api/purchases')
      .set(auth(shop))
      .send({ supplierId: owing, items: [{ variantId, quantity: 2, unitCostPaise: toPaise(500) }] })
      .expect(201);

    const due = await api().get('/api/suppliers').query({ withDueOnly: 'true' }).set(auth(shop)).expect(200);
    expect(due.body.items.map((s: { name: string }) => s.name)).toEqual(['Owed Traders']);
    expect(due.body.summary.outstandingPaise).toBe(toPaise(1000));
  });

  it('records serial numbers received against a purchase', async () => {
    const shop = await createTestShop('ELECTRONICS', { taxEnabled: false });
    const supplierId = await supplierFor(shop, 'Gadget Hub');
    const created = await api()
      .post('/api/products')
      .set(auth(shop))
      .send({ name: 'Bluetooth Speaker', unitCode: 'PCS', trackSerial: true, ignoreDuplicateWarning: true })
      .expect(201);

    await api()
      .post('/api/purchases')
      .set(auth(shop))
      .send({
        supplierId,
        items: [
          {
            variantId: created.body.variants[0].id,
            quantity: 3,
            unitCostPaise: toPaise(900),
            serials: ['SPK-001', 'SPK-002', 'SPK-003'],
          },
        ],
      })
      .expect(201);

    const serials = await api()
      .get(`/api/inventory/serials/${created.body.variants[0].id}`)
      .set(auth(shop))
      .expect(200);
    expect(serials.body.serials).toHaveLength(3);
    expect(serials.body.serials.every((s: { status: string }) => s.status === 'IN_STOCK')).toBe(true);
  });
});
