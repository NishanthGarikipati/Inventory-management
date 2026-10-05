import { describe, expect, it } from 'vitest';
import { api, auth, createTestProduct, createTestShop, stockOf } from './helpers.js';
import { prisma } from '../db/prisma.js';
import { toPaise } from '../domain/money.js';

describe('selling', () => {
  it('records a cash bill, drops stock and prints a receipt', async () => {
    const shop = await createTestShop();
    const milk = await createTestProduct(shop, { name: 'Milk 1L', stock: 20, purchase: 50, selling: 60 });
    const bread = await createTestProduct(shop, { name: 'Bread', stock: 10, purchase: 30, selling: 40 });

    const sale = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({
        items: [
          { variantId: milk.variantId, quantity: 2 },
          { variantId: bread.variantId, quantity: 1 },
        ],
        payments: [{ method: 'CASH', amountPaise: toPaise(160) }],
      })
      .expect(201);

    expect(sale.body.totalPaise).toBe(toPaise(160));
    expect(sale.body.paidPaise).toBe(toPaise(160));
    expect(sale.body.duePaise).toBe(0);
    expect(sale.body.status).toBe('COMPLETED');
    expect(sale.body.invoiceNumber).toBeTruthy();

    expect(await stockOf(milk.variantId)).toBe(18);
    expect(await stockOf(bread.variantId)).toBe(9);

    const receipt = await api().get(`/api/sales/${sale.body.id}/receipt`).set(auth(shop)).expect(200);
    expect(receipt.body.number).toBe(sale.body.invoiceNumber);
    expect(receipt.body.receipt.items).toHaveLength(2);
    expect(receipt.body.receipt.totalPaise).toBe(toPaise(160));
  });

  it('returns the change due when the customer hands over more cash', async () => {
    const shop = await createTestShop();
    const { variantId } = await createTestProduct(shop, { name: 'Soap', stock: 10, selling: 45 });

    const sale = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({
        items: [{ variantId, quantity: 2 }],
        payments: [{ method: 'CASH', amountPaise: toPaise(100) }],
      })
      .expect(201);

    expect(sale.body.totalPaise).toBe(toPaise(90));
    expect(sale.body.paidPaise).toBe(toPaise(90));
    expect(sale.body.changePaise).toBe(toPaise(10));
  });

  it('refuses a card or UPI payment larger than the bill', async () => {
    const shop = await createTestShop();
    const { variantId } = await createTestProduct(shop, { name: 'Shampoo', stock: 5, selling: 100 });

    const response = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({
        items: [{ variantId, quantity: 1 }],
        payments: [{ method: 'UPI', amountPaise: toPaise(500) }],
      })
      .expect(400);

    expect(response.body.error.message).toMatch(/more than the bill/i);
  });

  it('will not leave a bill unpaid unless it is booked to a customer', async () => {
    const shop = await createTestShop();
    const { variantId } = await createTestProduct(shop, { name: 'Sugar 1KG', stock: 10, selling: 50 });

    const response = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 1 }], payments: [] })
      .expect(400);

    expect(response.body.error.message).toBe('Choose a customer before giving credit.');
    expect(response.body.error.actions.map((a: { action: string }) => a.action)).toEqual([
      'SELECT_CUSTOMER',
      'COLLECT_FULL',
    ]);
    expect(await stockOf(variantId)).toBe(10);
  });

  it('splits one bill across several payment methods', async () => {
    const shop = await createTestShop();
    const { variantId } = await createTestProduct(shop, { name: 'Rice 5KG', stock: 10, selling: 340 });

    const sale = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({
        items: [{ variantId, quantity: 2 }],
        payments: [
          { method: 'CASH', amountPaise: toPaise(200) },
          { method: 'UPI', amountPaise: toPaise(480), reference: 'UPI-9981' },
        ],
      })
      .expect(201);

    expect(sale.body.totalPaise).toBe(toPaise(680));
    expect(sale.body.duePaise).toBe(0);
    expect(sale.body.payments).toHaveLength(2);
  });

  it('computes tax on top of the price when the shop prices exclusive of tax', async () => {
    const shop = await createTestShop('KIRANA', { pricesIncludeTax: false });
    const { variantId } = await createTestProduct(shop, { name: 'Biscuit Pack', stock: 10, selling: 100, taxRate: 18 });

    const sale = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 1 }], payments: [{ method: 'CASH', amountPaise: toPaise(118) }] })
      .expect(201);

    expect(sale.body.subtotalPaise).toBe(toPaise(100));
    expect(sale.body.taxPaise).toBe(toPaise(18));
    expect(sale.body.totalPaise).toBe(toPaise(118));
  });

  it('carves tax out of the price when the shop prices inclusive of tax', async () => {
    const shop = await createTestShop('KIRANA', { pricesIncludeTax: true });
    const { variantId } = await createTestProduct(shop, { name: 'Biscuit Pack', stock: 10, selling: 118, taxRate: 18 });

    const sale = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 1 }], payments: [{ method: 'CASH', amountPaise: toPaise(118) }] })
      .expect(201);

    expect(sale.body.taxPaise).toBe(toPaise(18));
    expect(sale.body.totalPaise).toBe(toPaise(118));
  });

  it('charges no tax at all when the shop has tax switched off', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { variantId } = await createTestProduct(shop, { name: 'Loose Rice', stock: 10, selling: 100, taxRate: 18 });

    const sale = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 1 }], payments: [{ method: 'CASH', amountPaise: toPaise(100) }] })
      .expect(201);

    expect(sale.body.taxPaise).toBe(0);
    expect(sale.body.totalPaise).toBe(toPaise(100));
  });

  it('spreads a bill level discount across the lines', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const a = await createTestProduct(shop, { name: 'Item A', stock: 10, selling: 300 });
    const b = await createTestProduct(shop, { name: 'Item B', stock: 10, selling: 100 });

    const sale = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({
        items: [
          { variantId: a.variantId, quantity: 1 },
          { variantId: b.variantId, quantity: 1 },
        ],
        discountPaise: toPaise(40),
        payments: [{ method: 'CASH', amountPaise: toPaise(360) }],
      })
      .expect(201);

    expect(sale.body.discountPaise).toBe(toPaise(40));
    expect(sale.body.totalPaise).toBe(toPaise(360));
    const lines = sale.body.items.sort((x: { discountPaise: number }, y: { discountPaise: number }) => y.discountPaise - x.discountPaise);
    expect(lines[0].discountPaise).toBe(toPaise(30));
    expect(lines[1].discountPaise).toBe(toPaise(10));
  });

  it('calculates gross profit from the moving average cost, not the list price', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { variantId } = await createTestProduct(shop, { name: 'Dal 1KG', stock: 10, purchase: 100, selling: 150 });

    const sale = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 4 }], payments: [{ method: 'CASH', amountPaise: toPaise(600) }] })
      .expect(201);

    expect(sale.body.cogsPaise).toBe(toPaise(400));
    expect(sale.body.grossProfitPaise).toBe(toPaise(200));
  });

  it('puts an unpaid bill on the customer account and clears it on payment', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { variantId } = await createTestProduct(shop, { name: 'Atta 5KG', stock: 10, selling: 320 });
    const customer = await api()
      .post('/api/customers')
      .set(auth(shop))
      .send({ name: 'Ramesh', phone: '9812345670', creditLimitPaise: toPaise(5000) })
      .expect(201);

    const sale = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({
        customerId: customer.body.id,
        items: [{ variantId, quantity: 2 }],
        payments: [{ method: 'CASH', amountPaise: toPaise(140) }],
      })
      .expect(201);

    expect(sale.body.duePaise).toBe(toPaise(500));
    expect(sale.body.status).toBe('COMPLETED');

    const afterSale = await api().get(`/api/customers/${customer.body.id}`).set(auth(shop)).expect(200);
    expect(afterSale.body.balancePaise).toBe(toPaise(500));

    await api()
      .post('/api/payments/customer')
      .set(auth(shop))
      .send({ customerId: customer.body.id, amountPaise: toPaise(500), method: 'UPI' })
      .expect(201);

    const settled = await api().get(`/api/customers/${customer.body.id}`).set(auth(shop)).expect(200);
    expect(settled.body.balancePaise).toBe(0);
    const settledSale = await api().get(`/api/sales/${sale.body.id}`).set(auth(shop)).expect(200);
    expect(settledSale.body.duePaise).toBe(0);
  });

  it('stops a credit sale that would push the customer past their limit', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { variantId } = await createTestProduct(shop, { name: 'Cement Bag', stock: 20, selling: 400 });
    const customer = await api()
      .post('/api/customers')
      .set(auth(shop))
      .send({ name: 'Suresh', phone: '9812345671', creditLimitPaise: toPaise(1000) })
      .expect(201);

    const blocked = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ customerId: customer.body.id, items: [{ variantId, quantity: 5 }], payments: [] })
      .expect(409);

    expect(blocked.body.error.message).toContain('Suresh');
    expect(blocked.body.error.message).toContain('credit limit');
    expect(await stockOf(variantId)).toBe(20);
  });

  it('will not sell a whole-unit product in fractions', async () => {
    const shop = await createTestShop();
    const { variantId } = await createTestProduct(shop, { name: 'Notebook', stock: 10, unitCode: 'PCS' });

    const response = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 1.5 }], payments: [{ method: 'CASH', amountPaise: toPaise(20) }] })
      .expect(400);

    expect(response.body.error.message).toMatch(/whole/i);
  });

  it('sells loose weight in decimals', async () => {
    const shop = await createTestShop('GROCERY', { taxEnabled: false });
    const { variantId } = await createTestProduct(shop, { name: 'Tomatoes', stock: 10, unitCode: 'KG', selling: 40 });

    const sale = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 1.25 }], payments: [{ method: 'CASH', amountPaise: toPaise(50) }] })
      .expect(201);

    expect(sale.body.totalPaise).toBe(toPaise(50));
    expect(await stockOf(variantId)).toBe(8.75);
  });

  it('cancels a bill, returns the stock and reverses the customer balance', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { variantId } = await createTestProduct(shop, { name: 'Sugar 1KG', stock: 20, selling: 50 });
    const customer = await api()
      .post('/api/customers')
      .set(auth(shop))
      .send({ name: 'Anita', phone: '9812345672', creditLimitPaise: toPaise(10000) })
      .expect(201);

    const sale = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ customerId: customer.body.id, items: [{ variantId, quantity: 4 }], payments: [] })
      .expect(201);

    expect(await stockOf(variantId)).toBe(16);

    const cancelled = await api()
      .post(`/api/sales/${sale.body.id}/cancel`)
      .set(auth(shop))
      .send({ reason: 'Billed by mistake' })
      .expect(200);

    expect(cancelled.body.status).toBe('CANCELLED');
    expect(await stockOf(variantId)).toBe(20);

    const after = await api().get(`/api/customers/${customer.body.id}`).set(auth(shop)).expect(200);
    expect(after.body.balancePaise).toBe(0);

    const audit = await api().get('/api/audit').query({ action: 'SALE_CANCELLED' }).set(auth(shop)).expect(200);
    expect(audit.body.logs).toHaveLength(1);
  });

  it('cannot cancel the same bill twice', async () => {
    const shop = await createTestShop();
    const { variantId } = await createTestProduct(shop, { name: 'Pen', stock: 10, selling: 10 });
    const sale = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 1 }], payments: [{ method: 'CASH', amountPaise: toPaise(10) }] })
      .expect(201);

    await api().post(`/api/sales/${sale.body.id}/cancel`).set(auth(shop)).send({ reason: 'Mistake' }).expect(200);
    const second = await api()
      .post(`/api/sales/${sale.body.id}/cancel`)
      .set(auth(shop))
      .send({ reason: 'Mistake' })
      .expect(409);
    expect(second.body.error.message).toMatch(/already/i);
  });

  it('sells a serialised phone and ties the serial to the bill', async () => {
    const shop = await createTestShop('ELECTRONICS', { taxEnabled: false });
    const created = await api()
      .post('/api/products')
      .set(auth(shop))
      .send({
        name: 'Smart Phone A15',
        unitCode: 'PCS',
        trackSerial: true,
        sellingPricePaise: toPaise(14999),
        ignoreDuplicateWarning: true,
      })
      .expect(201);
    const variantId = created.body.variants[0].id;
    const supplier = await api().post('/api/suppliers').set(auth(shop)).send({ name: 'Mobile World' }).expect(201);

    await api()
      .post('/api/purchases')
      .set(auth(shop))
      .send({
        supplierId: supplier.body.id,
        items: [
          {
            variantId,
            quantity: 2,
            unitCostPaise: toPaise(13000),
            serials: ['IMEI-111111111111111', 'IMEI-222222222222222'],
          },
        ],
      })
      .expect(201);

    const sale = await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({
        items: [{ variantId, quantity: 1, serials: ['IMEI-111111111111111'] }],
        payments: [{ method: 'CARD', amountPaise: toPaise(14999) }],
      })
      .expect(201);

    const serials = await prisma.serialItem.findMany({ where: { variantId }, orderBy: { serial: 'asc' } });
    expect(serials.map((s) => s.status)).toEqual(['SOLD', 'IN_STOCK']);
    expect(serials[0].saleId).toBe(sale.body.id);
  });

  it('consumes recipe ingredients when a menu item is sold', async () => {
    const shop = await createTestShop('RESTAURANT', { taxEnabled: false });
    const flour = await createTestProduct(shop, { name: 'Flour', stock: 10, unitCode: 'KG', purchase: 40 });
    const sugar = await createTestProduct(shop, { name: 'Sugar', stock: 5, unitCode: 'KG', purchase: 45 });
    const cake = await api()
      .post('/api/products')
      .set(auth(shop))
      .send({
        name: 'Chocolate Cake',
        unitCode: 'PCS',
        isComposite: true,
        sellingPricePaise: toPaise(450),
        ignoreDuplicateWarning: true,
      })
      .expect(201);

    await api()
      .post('/api/production/recipes')
      .set(auth(shop))
      .send({
        productId: cake.body.id,
        name: 'Chocolate Cake',
        autoConsumeOnSale: true,
        items: [
          { variantId: flour.variantId, quantity: 0.5 },
          { variantId: sugar.variantId, quantity: 0.3 },
        ],
      })
      .expect(201);

    await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({
        items: [{ variantId: cake.body.variants[0].id, quantity: 2 }],
        payments: [{ method: 'CASH', amountPaise: toPaise(900) }],
      })
      .expect(201);

    expect(await stockOf(flour.variantId)).toBe(9);
    expect(await stockOf(sugar.variantId)).toBe(4.4);

    const ledger = await api().get(`/api/inventory/ledger/${flour.variantId}`).set(auth(shop)).expect(200);
    expect(ledger.body.transactions[0].type).toBe('CONSUMPTION');
  });

  it('lists bills for a day and filters by customer', async () => {
    const shop = await createTestShop();
    const { variantId } = await createTestProduct(shop, { name: 'Salt', stock: 50, selling: 20 });
    const customer = await api().post('/api/customers').set(auth(shop)).send({ name: 'Walk-in Regular', phone: '9812345673' }).expect(201);

    await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 1 }], payments: [{ method: 'CASH', amountPaise: toPaise(20) }] })
      .expect(201);
    await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ customerId: customer.body.id, items: [{ variantId, quantity: 2 }], payments: [] })
      .expect(201);

    const all = await api().get('/api/sales').set(auth(shop)).expect(200);
    expect(all.body.total).toBe(2);

    const mine = await api().get('/api/sales').query({ customerId: customer.body.id }).set(auth(shop)).expect(200);
    expect(mine.body.total).toBe(1);
  });
});
