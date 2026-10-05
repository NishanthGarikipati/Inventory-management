import { describe, expect, it } from 'vitest';
import { api, auth, createTestProduct, createTestShop, stockOf } from './helpers.js';
import { toPaise } from '../domain/money.js';

describe('returns', () => {
  it('takes goods back from a customer, refunds and puts the stock back', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { variantId } = await createTestProduct(shop, { name: 'Rice 5KG', stock: 20, purchase: 300, selling: 340 });

    const sale = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 3 }], payments: [{ method: 'CASH', amountPaise: toPaise(1020) }] })
      .expect(201);

    const returned = await api()
      .post('/api/returns/sales')
      .set(auth(shop))
      .send({
        saleId: sale.body.id,
        reason: 'Customer did not need it',
        refundMethod: 'CASH',
        items: [{ saleItemId: sale.body.items[0].id, quantity: 1 }],
      })
      .expect(201);

    expect(returned.body.totalPaise).toBe(toPaise(340));
    expect(returned.body.returnNumber).toBeTruthy();
    expect(await stockOf(variantId)).toBe(18);

    const ledger = await api().get(`/api/inventory/ledger/${variantId}`).set(auth(shop)).expect(200);
    expect(ledger.body.transactions[0]).toMatchObject({ type: 'SALE_RETURN', quantity: 1 });
  });

  it('will not accept more back than was sold on the bill', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { variantId } = await createTestProduct(shop, { name: 'Soap', stock: 20, selling: 45 });

    const sale = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 2 }], payments: [{ method: 'CASH', amountPaise: toPaise(90) }] })
      .expect(201);

    await api()
      .post('/api/returns/sales')
      .set(auth(shop))
      .send({ saleId: sale.body.id, reason: 'Damaged', items: [{ saleItemId: sale.body.items[0].id, quantity: 2 }] })
      .expect(201);

    const twice = await api()
      .post('/api/returns/sales')
      .set(auth(shop))
      .send({ saleId: sale.body.id, reason: 'Damaged', items: [{ saleItemId: sale.body.items[0].id, quantity: 1 }] })
      .expect(409);

    expect(twice.body.error.message).toMatch(/can still be returned/i);
    expect(await stockOf(variantId)).toBe(20);
  });

  it('keeps unsellable returns off the shelf', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { variantId } = await createTestProduct(shop, { name: 'Milk 1L', stock: 10, selling: 60 });

    const sale = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 2 }], payments: [{ method: 'CASH', amountPaise: toPaise(120) }] })
      .expect(201);

    await api()
      .post('/api/returns/sales')
      .set(auth(shop))
      .send({
        saleId: sale.body.id,
        reason: 'Spoiled',
        items: [{ saleItemId: sale.body.items[0].id, quantity: 2, restock: false }],
      })
      .expect(201);

    expect(await stockOf(variantId)).toBe(8);

    const ledger = await api().get(`/api/inventory/ledger/${variantId}`).set(auth(shop)).expect(200);
    const types = ledger.body.transactions.map((t: { type: string }) => t.type);
    // The goods come back and are immediately written off, so both halves of
    // the story stay in the ledger.
    expect(types.slice(0, 2)).toEqual(['DAMAGE', 'SALE_RETURN']);
  });

  it('reduces the customer due instead of paying cash back', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { variantId } = await createTestProduct(shop, { name: 'Atta 5KG', stock: 20, selling: 320 });
    const customer = await api()
      .post('/api/customers')
      .set(auth(shop))
      .send({ name: 'Lakshmi', phone: '9800000011', creditLimitPaise: toPaise(10000) })
      .expect(201);

    const sale = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ customerId: customer.body.id, items: [{ variantId, quantity: 2 }], payments: [] })
      .expect(201);

    expect(sale.body.duePaise).toBe(toPaise(640));

    await api()
      .post('/api/returns/sales')
      .set(auth(shop))
      .send({
        saleId: sale.body.id,
        reason: 'Wrong item',
        refundMethod: 'ADJUST_DUE',
        items: [{ saleItemId: sale.body.items[0].id, quantity: 1 }],
      })
      .expect(201);

    const after = await api().get(`/api/customers/${customer.body.id}`).set(auth(shop)).expect(200);
    expect(after.body.balancePaise).toBe(toPaise(320));
  });

  it('sends goods back to a supplier and cuts the amount owed', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const supplier = await api()
      .post('/api/suppliers')
      .set(auth(shop))
      .send({ name: 'ABC Distributors', phone: '9876511111' })
      .expect(201);
    const { variantId } = await createTestProduct(shop, { name: 'Oil 1L', stock: 0 });

    const purchase = await api()
      .post('/api/purchases')
      .set(auth(shop))
      .send({ supplierId: supplier.body.id, items: [{ variantId, quantity: 15, unitCostPaise: toPaise(110) }] })
      .expect(201);

    const returned = await api()
      .post('/api/returns/purchases')
      .set(auth(shop))
      .send({
        purchaseId: purchase.body.id,
        reason: 'Leaking pouches',
        settlement: 'ADJUST_DUE',
        items: [{ purchaseItemId: purchase.body.items[0].id, quantity: 5 }],
      })
      .expect(201);

    expect(returned.body.totalPaise).toBe(toPaise(550));
    expect(await stockOf(variantId)).toBe(10);

    const after = await api().get(`/api/suppliers/${supplier.body.id}`).set(auth(shop)).expect(200);
    expect(after.body.balancePaise).toBe(toPaise(1100));

    const ledger = await api().get(`/api/inventory/ledger/${variantId}`).set(auth(shop)).expect(200);
    expect(ledger.body.transactions[0]).toMatchObject({ type: 'PURCHASE_RETURN', quantity: -5 });
  });

  it('will not send back stock that is no longer on the shelf', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const supplier = await api()
      .post('/api/suppliers')
      .set(auth(shop))
      .send({ name: 'Quick Traders', phone: '9876511112' })
      .expect(201);
    const { variantId } = await createTestProduct(shop, { name: 'Cold Drink', stock: 0, selling: 40 });

    const purchase = await api()
      .post('/api/purchases')
      .set(auth(shop))
      .send({ supplierId: supplier.body.id, items: [{ variantId, quantity: 4, unitCostPaise: toPaise(25) }] })
      .expect(201);

    await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 4 }], payments: [{ method: 'CASH', amountPaise: toPaise(160) }] })
      .expect(201);

    const response = await api()
      .post('/api/returns/purchases')
      .set(auth(shop))
      .send({
        purchaseId: purchase.body.id,
        reason: 'Expired batch',
        items: [{ purchaseItemId: purchase.body.items[0].id, quantity: 4 }],
      })
      .expect(409);

    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('lists both kinds of returns for the reports screen', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { variantId } = await createTestProduct(shop, { name: 'Salt', stock: 20, selling: 20 });
    const sale = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 2 }], payments: [{ method: 'CASH', amountPaise: toPaise(40) }] })
      .expect(201);
    await api()
      .post('/api/returns/sales')
      .set(auth(shop))
      .send({ saleId: sale.body.id, reason: 'Changed mind', items: [{ saleItemId: sale.body.items[0].id, quantity: 1 }] })
      .expect(201);

    const salesReturns = await api().get('/api/returns/sales').set(auth(shop)).expect(200);
    expect(salesReturns.body.returns).toHaveLength(1);

    const purchaseReturns = await api().get('/api/returns/purchases').set(auth(shop)).expect(200);
    expect(purchaseReturns.body.returns).toHaveLength(0);
  });
});
