import { describe, expect, it } from 'vitest';
import { addStaff, api, auth, createTestProduct, createTestShop, stockOf } from './helpers.js';
import { prisma } from '../db/prisma.js';
import { toPaise } from '../domain/money.js';

describe('working offline and syncing later', () => {
  it('hands the phone everything it needs to bill without a network', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    await createTestProduct(shop, { name: 'Rice 5KG', stock: 12, selling: 340, barcode: '8901111222333' });
    await api().post('/api/customers').set(auth(shop)).send({ name: 'Ramesh', phone: '9700001111' }).expect(201);
    await api().post('/api/suppliers').set(auth(shop)).send({ name: 'ABC Distributors', phone: '9700002222' }).expect(201);

    const pull = await api().get('/api/sync/pull').set(auth(shop)).expect(200);

    expect(pull.body.business.name).toBeTruthy();
    expect(pull.body.settings).toBeTruthy();
    expect(pull.body.products).toHaveLength(1);
    expect(pull.body.products[0].variants[0].barcode).toBe('8901111222333');
    expect(pull.body.inventory[0].quantity).toBe(12);
    expect(pull.body.customers).toHaveLength(1);
    expect(pull.body.suppliers).toHaveLength(1);
    expect(pull.body.syncedAt).toBeTruthy();
  });

  it('only sends back what changed since the last sync', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    await createTestProduct(shop, { name: 'Old Product', stock: 5 });

    const first = await api().get('/api/sync/pull').set(auth(shop)).expect(200);
    expect(first.body.products).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await createTestProduct(shop, { name: 'New Product', stock: 5 });

    const second = await api().get('/api/sync/pull').query({ since: first.body.syncedAt }).set(auth(shop)).expect(200);
    expect(second.body.products.map((p: { name: string }) => p.name)).toEqual(['New Product']);
  });

  it('replays a queue of offline work in one go', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { variantId } = await createTestProduct(shop, { name: 'Rice 5KG', stock: 20, purchase: 300, selling: 340 });
    const customer = await api()
      .post('/api/customers')
      .set(auth(shop))
      .send({ name: 'Ramesh', phone: '9700003333', creditLimitPaise: toPaise(50000) })
      .expect(201);

    const response = await api()
      .post('/api/sync/push')
      .set(auth(shop))
      .send({
        operations: [
          {
            clientRequestId: 'offline-sale-1',
            type: 'SALE',
            payload: {
              items: [{ variantId, quantity: 2 }],
              payments: [{ method: 'CASH', amountPaise: toPaise(680) }],
            },
          },
          {
            clientRequestId: 'offline-sale-2',
            type: 'SALE',
            payload: { customerId: customer.body.id, items: [{ variantId, quantity: 1 }], payments: [] },
          },
          {
            clientRequestId: 'offline-payment-1',
            type: 'CUSTOMER_PAYMENT',
            payload: { customerId: customer.body.id, amountPaise: toPaise(340), method: 'UPI' },
          },
          {
            clientRequestId: 'offline-expense-1',
            type: 'EXPENSE',
            payload: { categoryName: 'Transport', amountPaise: toPaise(200), method: 'CASH' },
          },
        ],
      })
      .expect(200);

    expect(response.body.applied).toBe(4);
    expect(response.body.failed).toBe(0);
    expect(await stockOf(variantId)).toBe(17);

    const settled = await api().get(`/api/customers/${customer.body.id}`).set(auth(shop)).expect(200);
    expect(settled.body.balancePaise).toBe(0);
  });

  it('never applies the same queued transaction twice', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { variantId } = await createTestProduct(shop, { name: 'Sugar 1KG', stock: 20, selling: 50 });

    const operation = {
      clientRequestId: 'flaky-connection-sale',
      type: 'SALE' as const,
      payload: {
        items: [{ variantId, quantity: 3 }],
        payments: [{ method: 'CASH', amountPaise: toPaise(150) }],
      },
    };

    const first = await api().post('/api/sync/push').set(auth(shop)).send({ operations: [operation] }).expect(200);
    expect(first.body.applied).toBe(1);

    // The phone never saw the reply and sends the same queue again.
    const second = await api().post('/api/sync/push').set(auth(shop)).send({ operations: [operation] }).expect(200);
    expect(second.body.duplicates).toBe(1);
    expect(second.body.applied).toBe(0);
    expect(second.body.results[0].result.id).toBe(first.body.results[0].result.id);

    expect(await stockOf(variantId)).toBe(17);
    expect(await prisma.sale.count({ where: { businessId: shop.businessId } })).toBe(1);
  });

  it('reports the failures in a batch without dropping the good work', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { variantId } = await createTestProduct(shop, { name: 'Oil 1L', stock: 2, selling: 110 });

    const response = await api()
      .post('/api/sync/push')
      .set(auth(shop))
      .send({
        operations: [
          {
            clientRequestId: 'good-sale',
            type: 'SALE',
            payload: {
              items: [{ variantId, quantity: 1 }],
              payments: [{ method: 'CASH', amountPaise: toPaise(110) }],
            },
          },
          {
            clientRequestId: 'impossible-sale',
            type: 'SALE',
            payload: {
              items: [{ variantId, quantity: 50 }],
              payments: [{ method: 'CASH', amountPaise: toPaise(5500) }],
            },
          },
        ],
      })
      .expect(200);

    expect(response.body.applied).toBe(1);
    expect(response.body.failed).toBe(1);

    const failure = response.body.results.find((r: { status: string }) => r.status === 'FAILED');
    expect(failure.error.code).toBe('INSUFFICIENT_STOCK');
    expect(failure.error.message).toContain('Oil 1L');
    expect(failure.error.actions.length).toBeGreaterThan(0);
    expect(await stockOf(variantId)).toBe(1);
  });

  it('lets the phone retry a failed operation once the problem is fixed', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { variantId } = await createTestProduct(shop, { name: 'Bread', stock: 1, selling: 40 });

    const operation = {
      clientRequestId: 'retry-me',
      type: 'SALE' as const,
      payload: {
        items: [{ variantId, quantity: 4 }],
        payments: [{ method: 'CASH', amountPaise: toPaise(160) }],
      },
    };

    const failed = await api().post('/api/sync/push').set(auth(shop)).send({ operations: [operation] }).expect(200);
    expect(failed.body.failed).toBe(1);

    await api()
      .post('/api/inventory/adjustment')
      .set(auth(shop))
      .send({ reason: 'COUNT_DIFF', lines: [{ variantId, countedQuantity: 10 }] })
      .expect(201);

    const retried = await api().post('/api/sync/push').set(auth(shop)).send({ operations: [operation] }).expect(200);
    expect(retried.body.applied).toBe(1);
    expect(await stockOf(variantId)).toBe(6);
  });

  it('applies the role rules to queued work too', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const cashier = await addStaff(shop, 'CASHIER');
    const { variantId } = await createTestProduct(shop, { name: 'Salt', stock: 20, selling: 20 });

    const response = await api()
      .post('/api/sync/push')
      .set(auth(cashier))
      .send({
        operations: [
          {
            clientRequestId: 'cashier-sale',
            type: 'SALE',
            payload: {
              items: [{ variantId, quantity: 1 }],
              payments: [{ method: 'CASH', amountPaise: toPaise(20) }],
            },
          },
          {
            clientRequestId: 'cashier-adjustment',
            type: 'ADJUSTMENT',
            payload: { reason: 'DAMAGED', lines: [{ variantId, quantityChange: -5 }] },
          },
        ],
      })
      .expect(200);

    expect(response.body.applied).toBe(1);
    expect(response.body.failed).toBe(1);
    expect(response.body.results[1].error.code).toBe('FORBIDDEN');
    expect(await stockOf(variantId)).toBe(19);
  });

  it('marks queued work as coming from the offline queue', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { variantId } = await createTestProduct(shop, { name: 'Tea 500G', stock: 10, selling: 240 });

    await api()
      .post('/api/sync/push')
      .set(auth(shop))
      .send({
        operations: [
          {
            clientRequestId: 'traceable-sale',
            type: 'SALE',
            payload: {
              items: [{ variantId, quantity: 1 }],
              payments: [{ method: 'CASH', amountPaise: toPaise(240) }],
            },
          },
        ],
      })
      .expect(200);

    const ledger = await api().get(`/api/inventory/ledger/${variantId}`).set(auth(shop)).expect(200);
    expect(ledger.body.transactions[0].source).toBe('OFFLINE_SYNC');
  });

  it('keeps one shop\u2019s queue out of another shop\u2019s books', async () => {
    const mine = await createTestShop('KIRANA', { taxEnabled: false });
    const theirs = await createTestShop('KIRANA', { taxEnabled: false });
    const { variantId } = await createTestProduct(mine, { name: 'Private Stock', stock: 10, selling: 100 });

    const response = await api()
      .post('/api/sync/push')
      .set(auth(theirs))
      .send({
        operations: [
          {
            clientRequestId: 'cross-tenant-sale',
            type: 'SALE',
            payload: {
              items: [{ variantId, quantity: 1 }],
              payments: [{ method: 'CASH', amountPaise: toPaise(100) }],
            },
          },
        ],
      })
      .expect(200);

    expect(response.body.failed).toBe(1);
    expect(await stockOf(variantId)).toBe(10);
  });

  it('treats the same request id sent to the normal endpoint as one transaction', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { variantId } = await createTestProduct(shop, { name: 'Soap', stock: 10, selling: 45 });
    const body = {
      items: [{ variantId, quantity: 2 }],
      payments: [{ method: 'CASH', amountPaise: toPaise(90) }],
    };

    const first = await api()
      .post('/api/sales')
      .set(auth(shop))
      .set({ 'Idempotency-Key': 'double-tap-on-pay' })
      .send(body)
      .expect(201);

    const second = await api()
      .post('/api/sales')
      .set(auth(shop))
      .set({ 'Idempotency-Key': 'double-tap-on-pay' })
      .send(body)
      .expect(200);

    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    expect(await stockOf(variantId)).toBe(8);
    expect(await prisma.sale.count({ where: { businessId: shop.businessId } })).toBe(1);
  });
});
