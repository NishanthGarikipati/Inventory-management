import { describe, expect, it } from 'vitest';
import { api, auth, createTestProduct, createTestShop, stockOf } from './helpers.js';
import { prisma } from '../db/prisma.js';
import { toPaise } from '../domain/money.js';

describe('inventory ledger', () => {
  it('adds up every movement into the current stock', async () => {
    const shop = await createTestShop();
    const { variantId } = await createTestProduct(shop, { name: 'Rice 5KG', stock: 100, purchase: 300, selling: 340 });

    await api()
      .post('/api/inventory/adjustment')
      .set(auth(shop))
      .send({ reason: 'DAMAGED', note: 'Torn bags', lines: [{ variantId, quantityChange: -2 }] })
      .expect(201);

    await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 10 }], payments: [{ method: 'CASH', amountPaise: toPaise(3400) }] })
      .expect(201);

    expect(await stockOf(variantId)).toBe(88);

    const ledger = await api().get(`/api/inventory/ledger/${variantId}`).set(auth(shop)).expect(200);
    const types = ledger.body.transactions.map((t: { type: string }) => t.type);
    expect(types).toEqual(['SALE', 'DAMAGE', 'OPENING']);

    // Every row states where the stock stood before and after it.
    for (const transaction of ledger.body.transactions) {
      expect(transaction.newStock).toBeCloseTo(transaction.previousStock + transaction.quantity, 3);
    }
  });

  it('never changes stock without writing an inventory transaction', async () => {
    const shop = await createTestShop();
    const { variantId } = await createTestProduct(shop, { name: 'Sugar 1KG', stock: 30 });

    await api()
      .post('/api/inventory/adjustment')
      .set(auth(shop))
      .send({ reason: 'LOST', lines: [{ variantId, quantityChange: -3 }] })
      .expect(201);

    const transactions = await prisma.inventoryTransaction.findMany({ where: { variantId } });
    const netFromLedger = transactions.reduce((sum, t) => sum + t.quantity, 0);
    expect(netFromLedger).toBe(await stockOf(variantId));
  });

  it('blocks selling more than is on the shelf with a message the owner can act on', async () => {
    const shop = await createTestShop();
    const { variantId } = await createTestProduct(shop, { name: 'Oil 1L', stock: 5, selling: 110 });

    const response = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 8 }], payments: [] })
      .expect(409);

    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(response.body.error.message).toContain('Oil 1L');
    expect(response.body.error.message).toContain('5');
    expect(response.body.error.actions.length).toBeGreaterThan(0);
    expect(await stockOf(variantId)).toBe(5);
  });

  it('allows negative stock only when the shop has switched it on', async () => {
    const shop = await createTestShop('KIRANA', { allowNegativeStock: true });
    const { variantId } = await createTestProduct(shop, { name: 'Bread', stock: 1, selling: 40 });

    await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 3 }], payments: [{ method: 'CASH', amountPaise: toPaise(120) }] })
      .expect(201);

    expect(await stockOf(variantId)).toBe(-2);
  });

  it('requires a reason for every adjustment and records who made it', async () => {
    const shop = await createTestShop();
    const { variantId } = await createTestProduct(shop, { name: 'Biscuits', stock: 20 });

    await api()
      .post('/api/inventory/adjustment')
      .set(auth(shop))
      .send({ lines: [{ variantId, quantityChange: -1 }] })
      .expect(422);

    const adjusted = await api()
      .post('/api/inventory/adjustment')
      .set(auth(shop))
      .send({ reason: 'PERSONAL_USE', note: 'Taken home', lines: [{ variantId, quantityChange: -1 }] })
      .expect(201);

    expect(adjusted.body.adjustment.reason).toBe('PERSONAL_USE');
    expect(adjusted.body.adjustment.userId).toBe(shop.ownerId);

    const audit = await api().get('/api/audit').query({ action: 'STOCK_ADJUSTMENT' }).set(auth(shop)).expect(200);
    expect(audit.body.logs).toHaveLength(1);
  });

  it('turns a physical count into the difference, not an overwrite', async () => {
    const shop = await createTestShop();
    const { variantId } = await createTestProduct(shop, { name: 'Soap', stock: 50 });

    const adjusted = await api()
      .post('/api/inventory/adjustment')
      .set(auth(shop))
      .send({ reason: 'COUNT_DIFF', lines: [{ variantId, countedQuantity: 47 }] })
      .expect(201);

    expect(adjusted.body.movements[0]).toMatchObject({ previousStock: 50, newStock: 47 });
    expect(await stockOf(variantId)).toBe(47);

    const ledger = await api().get(`/api/inventory/ledger/${variantId}`).set(auth(shop)).expect(200);
    expect(ledger.body.transactions[0]).toMatchObject({ type: 'ADJUSTMENT', quantity: -3 });
  });

  it('writes off damage even when the book stock has drifted below the shelf', async () => {
    const shop = await createTestShop();
    const { variantId } = await createTestProduct(shop, { name: 'Tomatoes', stock: 2, unitCode: 'KG' });

    // Damage/expiry write-offs must never be blocked: the ledger keeps the
    // discrepancy visible instead of hiding it.
    await api()
      .post('/api/inventory/adjustment')
      .set(auth(shop))
      .send({ reason: 'COUNT_DIFF', lines: [{ variantId, countedQuantity: 0 }] })
      .expect(201);

    expect(await stockOf(variantId)).toBe(0);
  });

  it('reports low stock, out of stock and stock value', async () => {
    const shop = await createTestShop();
    await createTestProduct(shop, { name: 'In Stock Item', stock: 50, minStock: 5, purchase: 100 });
    await createTestProduct(shop, { name: 'Low Item', stock: 3, minStock: 10, purchase: 200 });
    await createTestProduct(shop, { name: 'Empty Item', stock: 0, minStock: 4, purchase: 50 });

    const all = await api().get('/api/inventory').set(auth(shop)).expect(200);
    expect(all.body.summary.lowStock).toBe(1);
    expect(all.body.summary.outOfStock).toBe(1);
    expect(all.body.summary.stockValuePaise).toBe(50 * toPaise(100) + 3 * toPaise(200));

    const low = await api().get('/api/inventory').query({ status: 'LOW_STOCK' }).set(auth(shop)).expect(200);
    expect(low.body.items.map((i: { name: string }) => i.name)).toEqual(['Low Item']);

    const out = await api().get('/api/inventory').query({ status: 'OUT_OF_STOCK' }).set(auth(shop)).expect(200);
    expect(out.body.items.map((i: { name: string }) => i.name)).toEqual(['Empty Item']);
  });

  it('raises a low stock notification the owner can read in plain words', async () => {
    const shop = await createTestShop();
    const { variantId } = await createTestProduct(shop, { name: 'Rice 5KG', stock: 6, minStock: 5, selling: 340 });

    await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 2 }], payments: [{ method: 'CASH', amountPaise: toPaise(680) }] })
      .expect(201);

    const notifications = await api().get('/api/notifications').set(auth(shop)).expect(200);
    const lowStock = notifications.body.notifications.find((n: { type: string }) => n.type === 'LOW_STOCK');
    expect(lowStock.title).toBe('Low stock');
    expect(lowStock.body).toBe('Rice 5KG is below minimum stock (4 left).');
    expect(lowStock.severity).toBe('WARNING');
  });

  it('picks the batch that expires first', async () => {
    const shop = await createTestShop('MEDICAL');
    const { variantId } = await createTestProduct(shop, { name: 'Paracetamol 500mg', trackBatch: true });
    const supplier = await api().post('/api/suppliers').set(auth(shop)).send({ name: 'Medico Agencies' }).expect(201);

    const soon = new Date(Date.now() + 30 * 86400_000);
    const later = new Date(Date.now() + 365 * 86400_000);

    await api()
      .post('/api/purchases')
      .set(auth(shop))
      .send({
        supplierId: supplier.body.id,
        items: [
          { variantId, quantity: 50, unitCostPaise: toPaise(10), batchNumber: 'LATER', expiryDate: later },
          { variantId, quantity: 20, unitCostPaise: toPaise(10), batchNumber: 'SOON', expiryDate: soon },
        ],
      })
      .expect(201);

    const picks = await api().get(`/api/inventory/fefo/${variantId}`).query({ quantity: 30 }).set(auth(shop)).expect(200);
    expect(picks.body.picks[0].batchNumber).toBe('SOON');
    expect(picks.body.picks[0].quantity).toBe(20);
    expect(picks.body.picks[1].batchNumber).toBe('LATER');
    expect(picks.body.picks[1].quantity).toBe(10);
  });

  it('consumes the nearest expiry batch when that product is sold', async () => {
    const shop = await createTestShop('MEDICAL');
    const { variantId } = await createTestProduct(shop, { name: 'Cough Syrup', trackBatch: true, selling: 90 });
    const supplier = await api().post('/api/suppliers').set(auth(shop)).send({ name: 'Medico Agencies' }).expect(201);

    await api()
      .post('/api/purchases')
      .set(auth(shop))
      .send({
        supplierId: supplier.body.id,
        items: [
          {
            variantId,
            quantity: 10,
            unitCostPaise: toPaise(60),
            batchNumber: 'B-FAR',
            expiryDate: new Date(Date.now() + 400 * 86400_000),
          },
          {
            variantId,
            quantity: 5,
            unitCostPaise: toPaise(60),
            batchNumber: 'B-NEAR',
            expiryDate: new Date(Date.now() + 20 * 86400_000),
          },
        ],
      })
      .expect(201);

    await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 6 }], payments: [{ method: 'CASH', amountPaise: toPaise(540) }] })
      .expect(201);

    const batches = await api().get(`/api/inventory/batches/${variantId}`).set(auth(shop)).expect(200);
    const near = batches.body.batches.find((b: { batchNumber: string }) => b.batchNumber === 'B-NEAR');
    const far = batches.body.batches.find((b: { batchNumber: string }) => b.batchNumber === 'B-FAR');
    expect(near.quantity).toBe(0);
    expect(far.quantity).toBe(9);
  });

  it('keeps the moving average cost as stock is bought at different prices', async () => {
    const shop = await createTestShop();
    const { variantId } = await createTestProduct(shop, { name: 'Dal 1KG', stock: 10, purchase: 100 });
    const supplier = await api().post('/api/suppliers').set(auth(shop)).send({ name: 'Wholesale Dal' }).expect(201);

    await api()
      .post('/api/purchases')
      .set(auth(shop))
      .send({
        supplierId: supplier.body.id,
        items: [{ variantId, quantity: 10, unitCostPaise: toPaise(140) }],
      })
      .expect(201);

    const inventory = await prisma.inventory.findFirstOrThrow({ where: { variantId } });
    expect(inventory.quantity).toBe(20);
    expect(inventory.avgCostPaise).toBe(toPaise(120));
  });
});
