import { describe, expect, it } from 'vitest';
import { api, auth, createTestProduct, createTestShop } from './helpers.js';
import { toPaise } from '../domain/money.js';

type Shop = Awaited<ReturnType<typeof createTestShop>>;

/** A shop with one day of trade behind it, used by most of the reports below. */
async function tradingDay(shop: Shop) {
  const rice = await createTestProduct(shop, {
    name: 'Rice 5KG',
    stock: 20,
    purchase: 300,
    selling: 340,
    minStock: 5,
  });
  const sugar = await createTestProduct(shop, { name: 'Sugar 1KG', stock: 40, purchase: 42, selling: 50 });

  const customer = await api()
    .post('/api/customers')
    .set(auth(shop))
    .send({ name: 'Ramesh', phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, creditLimitPaise: toPaise(50000) })
    .expect(201);

  await api()
    .post('/api/sales')
    .set(auth(shop))
    .send({
      items: [
        { variantId: rice.variantId, quantity: 2 },
        { variantId: sugar.variantId, quantity: 4 },
      ],
      payments: [{ method: 'CASH', amountPaise: toPaise(880) }],
    })
    .expect(201);

  await api()
    .post('/api/sales')
    .set(auth(shop))
    .send({
      customerId: customer.body.id,
      items: [{ variantId: rice.variantId, quantity: 1 }],
      payments: [{ method: 'UPI', amountPaise: toPaise(140) }],
    })
    .expect(201);

  await api()
    .post('/api/expenses')
    .set(auth(shop))
    .send({ categoryName: 'Transport', amountPaise: toPaise(200), method: 'CASH', description: 'Tempo' })
    .expect(201);

  return { rice, sugar, customer: customer.body };
}

describe('dashboard', () => {
  it('answers what happened today in one call', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { rice } = await tradingDay(shop);

    const dashboard = await api().get('/api/dashboard').set(auth(shop)).expect(200);

    expect(dashboard.body.greeting).toMatch(/good (morning|afternoon|evening)/i);
    expect(dashboard.body.today.salesPaise).toBe(toPaise(1220));
    expect(dashboard.body.today.billCount).toBe(2);
    expect(dashboard.body.today.expensesPaise).toBe(toPaise(200));
    // 3 bags of rice at 40 margin, 4 kg sugar at 8 margin.
    expect(dashboard.body.today.grossProfitPaise).toBe(toPaise(152));
    expect(dashboard.body.today.creditGivenPaise).toBe(toPaise(200));
    expect(dashboard.body.alerts.customerDuePaise).toBe(toPaise(200));
    expect(dashboard.body.stockValuePaise).toBe(17 * toPaise(300) + 36 * toPaise(42));
    expect(dashboard.body.topProducts[0].variantId).toBe(rice.variantId);
  });

  it('counts what needs attention', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    await createTestProduct(shop, { name: 'Low Item', stock: 2, minStock: 10 });
    await createTestProduct(shop, { name: 'Finished Item', stock: 0, minStock: 4 });

    const dashboard = await api().get('/api/dashboard').set(auth(shop)).expect(200);
    expect(dashboard.body.alerts.lowStock).toBe(1);
    expect(dashboard.body.alerts.outOfStock).toBe(1);
    expect(dashboard.body.alerts.scansAwaitingReview).toBe(0);
  });

  it('shows the things that matter to the business type', async () => {
    const pharmacy = await createTestShop('MEDICAL');
    const bakery = await createTestShop('BAKERY');

    const pharmacyDash = await api().get('/api/dashboard').set(auth(pharmacy)).expect(200);
    const bakeryDash = await api().get('/api/dashboard').set(auth(bakery)).expect(200);

    expect(pharmacyDash.body.features.EXPIRY_TRACKING).toBe(true);
    expect(pharmacyDash.body.features.FEFO).toBe(true);
    expect(pharmacyDash.body.highlights.length).toBeGreaterThan(0);

    expect(bakeryDash.body.features.RECIPES).toBe(true);
    expect(bakeryDash.body.features.PRODUCTION).toBe(true);
    expect(bakeryDash.body.features.FEFO).toBe(false);
  });
});

describe('reports', () => {
  it('reports sales by day and by payment method', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    await tradingDay(shop);

    const report = await api().get('/api/reports/sales').set(auth(shop)).expect(200);
    expect(report.body.totals.salesPaise).toBe(toPaise(1220));
    expect(report.body.totals.billCount).toBe(2);
    expect(report.body.totals.duePaise).toBe(toPaise(200));
    expect(report.body.totals.averageBillPaise).toBe(toPaise(610));
    expect(report.body.byDay).toHaveLength(1);
    expect(report.body.byPaymentMethod).toEqual({ CASH: toPaise(880), UPI: toPaise(140) });
  });

  it('separates revenue, cost, gross profit and expenses instead of calling it all profit', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    await tradingDay(shop);

    const profit = await api().get('/api/reports/profit').set(auth(shop)).expect(200);
    expect(profit.body.revenuePaise).toBe(toPaise(1220));
    expect(profit.body.cogsPaise).toBe(toPaise(1068));
    expect(profit.body.grossProfitPaise).toBe(toPaise(152));
    expect(profit.body.expensesPaise).toBe(toPaise(200));
    expect(profit.body.estimatedNetProfitPaise).toBe(toPaise(-48));
    expect(profit.body).not.toHaveProperty('netProfitPaise');
  });

  it('keeps tax out of revenue when the shop charges tax', async () => {
    const shop = await createTestShop('KIRANA', { pricesIncludeTax: false });
    const { variantId } = await createTestProduct(shop, { name: 'Biscuits', stock: 10, purchase: 60, selling: 100, taxRate: 18 });

    await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({ items: [{ variantId, quantity: 1 }], payments: [{ method: 'CASH', amountPaise: toPaise(118) }] })
      .expect(201);

    const profit = await api().get('/api/reports/profit').set(auth(shop)).expect(200);
    expect(profit.body.taxCollectedPaise).toBe(toPaise(18));
    expect(profit.body.revenuePaise).toBe(toPaise(100));
    expect(profit.body.grossProfitPaise).toBe(toPaise(40));
  });

  it('ranks products and groups sales by category', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const staple = await api()
      .post('/api/products')
      .set(auth(shop))
      .send({
        name: 'Rice 5KG',
        unitCode: 'KG',
        categoryName: 'Staples',
        purchasePricePaise: toPaise(300),
        sellingPricePaise: toPaise(340),
        openingStock: 20,
        ignoreDuplicateWarning: true,
      })
      .expect(201);
    const snack = await api()
      .post('/api/products')
      .set(auth(shop))
      .send({
        name: 'Chips',
        unitCode: 'PCS',
        categoryName: 'Snacks',
        purchasePricePaise: toPaise(15),
        sellingPricePaise: toPaise(20),
        openingStock: 50,
        ignoreDuplicateWarning: true,
      })
      .expect(201);

    await api()
      .post('/api/sales')
      .set(auth(shop))
      .send({
        items: [
          { variantId: staple.body.variants[0].id, quantity: 3 },
          { variantId: snack.body.variants[0].id, quantity: 5 },
        ],
        payments: [{ method: 'CASH', amountPaise: toPaise(1120) }],
      })
      .expect(201);

    const top = await api().get('/api/reports/sales/products').set(auth(shop)).expect(200);
    expect(top.body.products[0]).toMatchObject({ name: 'Rice 5KG', quantity: 3, revenuePaise: toPaise(1020) });
    expect(top.body.products[1].name).toBe('Chips');

    const categories = await api().get('/api/reports/sales/categories').set(auth(shop)).expect(200);
    expect(categories.body.categories.map((c: { category: string }) => c.category)).toEqual(['Staples', 'Snacks']);
    expect(categories.body.categories[0].profitPaise).toBe(toPaise(120));
  });

  it('values stock at cost and at shelf price', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    await createTestProduct(shop, { name: 'Rice 5KG', stock: 10, purchase: 300, selling: 340 });

    const report = await api().get('/api/reports/inventory').set(auth(shop)).expect(200);
    expect(report.body.totals.products).toBe(1);
    expect(report.body.totals.stockValuePaise).toBe(toPaise(3000));
    expect(report.body.totals.retailValuePaise).toBe(toPaise(3400));
  });

  it('lists who owes the shop and who the shop owes', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    await tradingDay(shop);
    const supplier = await api()
      .post('/api/suppliers')
      .set(auth(shop))
      .send({ name: 'ABC Distributors', phone: '9876543210' })
      .expect(201);
    const { variantId } = await createTestProduct(shop, { name: 'Oil 1L', stock: 0 });
    await api()
      .post('/api/purchases')
      .set(auth(shop))
      .send({ supplierId: supplier.body.id, items: [{ variantId, quantity: 10, unitCostPaise: toPaise(110) }] })
      .expect(201);

    const report = await api().get('/api/reports/outstanding').set(auth(shop)).expect(200);
    expect(report.body.totals.customerDuePaise).toBe(toPaise(200));
    expect(report.body.totals.supplierDuePaise).toBe(toPaise(1100));
    expect(report.body.customers[0].name).toBe('Ramesh');
    expect(report.body.suppliers[0].name).toBe('ABC Distributors');
  });

  it('groups expenses by category', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    await api()
      .post('/api/expenses')
      .set(auth(shop))
      .send({ categoryName: 'Rent', amountPaise: toPaise(8000), method: 'UPI' })
      .expect(201);
    await api()
      .post('/api/expenses')
      .set(auth(shop))
      .send({ categoryName: 'Electricity', amountPaise: toPaise(1500), method: 'CASH' })
      .expect(201);
    await api()
      .post('/api/expenses')
      .set(auth(shop))
      .send({ categoryName: 'Rent', amountPaise: toPaise(500), method: 'CASH' })
      .expect(201);

    const report = await api().get('/api/reports/expenses').set(auth(shop)).expect(200);
    expect(report.body.totalPaise).toBe(toPaise(10000));
    expect(report.body.count).toBe(3);
    const rent = report.body.byCategory.find((c: { category: string }) => c.category === 'Rent');
    expect(rent.amountPaise).toBe(toPaise(8500));
  });

  it('summarises money in and money out', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { customer } = await tradingDay(shop);

    await api()
      .post('/api/payments/customer')
      .set(auth(shop))
      .send({ customerId: customer.id, amountPaise: toPaise(200), method: 'CASH' })
      .expect(201);

    const report = await api().get('/api/reports/payments').set(auth(shop)).expect(200);
    expect(report.body.salesByMethod.CASH).toBe(toPaise(880));
    expect(report.body.salesByMethod.UPI).toBe(toPaise(140));
    expect(report.body.customerCollectionPaise).toBe(toPaise(200));
    expect(report.body.customerCollectionCount).toBe(1);
  });

  it('shows every stock movement grouped by reason', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { rice } = await tradingDay(shop);

    await api()
      .post('/api/inventory/adjustment')
      .set(auth(shop))
      .send({ reason: 'DAMAGED', lines: [{ variantId: rice.variantId, quantityChange: -1 }] })
      .expect(201);

    const report = await api().get('/api/reports/stock-movement').set(auth(shop)).expect(200);
    expect(report.body.byType.OPENING).toBe(60);
    expect(report.body.byType.SALE).toBe(-7);
    expect(report.body.byType.DAMAGE).toBe(-1);

    const single = await api()
      .get('/api/reports/stock-movement')
      .query({ variantId: rice.variantId })
      .set(auth(shop))
      .expect(200);
    expect(single.body.transactions.every((t: { product: string }) => t.product === 'Rice 5KG')).toBe(true);
  });

  it('accepts the date presets the owner sees on screen', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    await tradingDay(shop);

    for (const preset of ['TODAY', 'YESTERDAY', 'THIS_WEEK', 'THIS_MONTH']) {
      const report = await api().get('/api/reports/sales').query({ preset }).set(auth(shop)).expect(200);
      expect(report.body.range.label).toBeTruthy();
    }

    const yesterday = await api().get('/api/reports/sales').query({ preset: 'YESTERDAY' }).set(auth(shop)).expect(200);
    expect(yesterday.body.totals.salesPaise).toBe(0);

    const custom = await api()
      .get('/api/reports/sales')
      .query({ preset: 'CUSTOM', from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) })
      .set(auth(shop))
      .expect(200);
    expect(custom.body.totals.salesPaise).toBe(toPaise(1220));
  });
});

describe('closing the day', () => {
  it('compares the cash the app expects with the cash in the box', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const { customer } = await tradingDay(shop);
    await api()
      .post('/api/payments/customer')
      .set(auth(shop))
      .send({ customerId: customer.id, amountPaise: toPaise(200), method: 'CASH' })
      .expect(201);

    const summary = await api().get('/api/closing/summary').set(auth(shop)).expect(200);
    expect(summary.body.salesPaise).toBe(toPaise(1220));
    expect(summary.body.cashPaise).toBe(toPaise(880));
    expect(summary.body.upiPaise).toBe(toPaise(140));
    expect(summary.body.creditPaise).toBe(toPaise(200));
    expect(summary.body.expensesPaise).toBe(toPaise(200));
    expect(summary.body.customerCollectionPaise).toBe(toPaise(200));
    // Cash sales plus collections minus cash expenses.
    expect(summary.body.expectedCashPaise).toBe(toPaise(880));
    expect(summary.body.closed).toBe(false);

    const closed = await api()
      .post('/api/closing')
      .set(auth(shop))
      .send({ actualCashPaise: toPaise(870), note: 'Ten rupees short' })
      .expect(201);

    expect(closed.body.differencePaise).toBe(toPaise(-10));

    const again = await api().post('/api/closing').set(auth(shop)).send({ actualCashPaise: toPaise(870) }).expect(409);
    expect(again.body.error.message).toMatch(/already closed/i);

    const history = await api().get('/api/closing').set(auth(shop)).expect(200);
    expect(history.body.closings).toHaveLength(1);
  });
});

describe('expenses', () => {
  it('records an expense against a category and can remove it', async () => {
    const shop = await createTestShop();
    const categories = await api().get('/api/expenses/categories').set(auth(shop)).expect(200);
    expect(categories.body.categories.map((c: { name: string }) => c.name)).toEqual(
      expect.arrayContaining(['Rent', 'Electricity', 'Salary', 'Transport']),
    );

    const created = await api()
      .post('/api/expenses')
      .set(auth(shop))
      .send({ categoryId: categories.body.categories[0].id, amountPaise: toPaise(7500), method: 'UPI' })
      .expect(201);

    const listed = await api().get('/api/expenses').set(auth(shop)).expect(200);
    expect(listed.body.total).toBe(1);

    await api().delete(`/api/expenses/${created.body.id}`).set(auth(shop)).expect(200);
    const afterDelete = await api().get('/api/expenses').set(auth(shop)).expect(200);
    expect(afterDelete.body.total).toBe(0);
  });

  it('refuses an expense of zero', async () => {
    const shop = await createTestShop();
    await api().post('/api/expenses').set(auth(shop)).send({ categoryName: 'Other', amountPaise: 0 }).expect(422);
  });
});
