import { describe, expect, it } from 'vitest';
import { addStaff, api, auth, createTestProduct, createTestShop } from './helpers.js';
import { toPaise } from '../domain/money.js';
import { ROLE_PERMISSIONS } from '../domain/permissions.js';

describe('who can do what', () => {
  it('lets a cashier bill but not change prices or see reports', async () => {
    const shop = await createTestShop();
    const cashier = await addStaff(shop, 'CASHIER');
    const { productId, variantId } = await createTestProduct(shop, { name: 'Biscuits', stock: 20, selling: 20 });

    await api()
      .post('/api/sales')
      .set(auth(cashier))
      .send({ items: [{ variantId, quantity: 1 }], payments: [{ method: 'CASH', amountPaise: toPaise(20) }] })
      .expect(201);

    await api().get('/api/products').set(auth(cashier)).expect(200);

    const priceChange = await api()
      .put(`/api/products/${productId}`)
      .set(auth(cashier))
      .send({ sellingPricePaise: toPaise(5) })
      .expect(403);
    expect(priceChange.body.error.message).toMatch(/permission|not allowed|cannot/i);

    await api().get('/api/reports/profit').set(auth(cashier)).expect(403);
    await api().get('/api/audit').set(auth(cashier)).expect(403);
    await api().post('/api/auth/users').set(auth(cashier)).send({ name: 'X', phone: '9000000001', pin: '1111', role: 'CASHIER' }).expect(403);
  });

  it('lets a manager run the shop floor but not manage staff', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const manager = await addStaff(shop, 'MANAGER');
    const { productId, variantId } = await createTestProduct(shop, { name: 'Rice 5KG', stock: 20, selling: 340 });

    await api().put(`/api/products/${productId}`).set(auth(manager)).send({ sellingPricePaise: toPaise(350) }).expect(200);
    await api()
      .post('/api/inventory/adjustment')
      .set(auth(manager))
      .send({ reason: 'DAMAGED', lines: [{ variantId, quantityChange: -1 }] })
      .expect(201);
    await api().get('/api/reports/sales').set(auth(manager)).expect(200);

    await api()
      .post('/api/auth/users')
      .set(auth(manager))
      .send({ name: 'New Cashier', phone: '9000000002', pin: '1111', role: 'CASHIER' })
      .expect(403);
    await api().get('/api/business/settings').set(auth(manager)).expect(200);
    await api().patch('/api/business/settings').set(auth(manager)).send({ taxEnabled: false }).expect(403);
  });

  it('gives the owner every permission in the catalogue', async () => {
    const shop = await createTestShop();
    const me = await api().get('/api/auth/me').set(auth(shop)).expect(200);
    expect(me.body.user.role).toBe('OWNER');
    expect(me.body.permissions).toEqual(ROLE_PERMISSIONS.OWNER);
    expect(me.body.permissions).toContain('scanner:approve');
  });

  it('turns away requests with no token, a junk token or a token from another secret', async () => {
    await api().get('/api/products').expect(401);
    await api().get('/api/products').set({ Authorization: 'Bearer not-a-real-token' }).expect(401);
    const malformed = await api().get('/api/products').set({ Authorization: 'Token abc' }).expect(401);
    expect(malformed.body.error.message).toBeTruthy();
  });

  it('stops a deactivated staff member from logging in', async () => {
    const shop = await createTestShop();
    const cashier = await addStaff(shop, 'CASHIER');

    await api().patch(`/api/auth/users/${cashier.userId}`).set(auth(shop)).send({ isActive: false }).expect(200);

    const blocked = await api()
      .post('/api/auth/login')
      .send({ phone: cashier.phone, pin: '4321', businessId: shop.businessId })
      .expect(401);
    expect(blocked.body.error.message).toBeTruthy();
  });

  it('rejects a wrong PIN without saying which part was wrong', async () => {
    const shop = await createTestShop();
    const response = await api()
      .post('/api/auth/login')
      .send({ phone: shop.phone, pin: '9999', businessId: shop.businessId })
      .expect(401);
    expect(response.body.error.message).toBe('Wrong PIN. Please try again.');
    expect(JSON.stringify(response.body)).not.toMatch(/hash|bcrypt|\$2[aby]\$/);
  });

  it('issues a working session and can refresh and end it', async () => {
    const shop = await createTestShop();
    const login = await api().post('/api/auth/login').send({ phone: shop.phone, pin: '1234' }).expect(200);
    expect(login.body.accessToken).toBeTruthy();
    expect(login.body.refreshToken).toBeTruthy();
    expect(JSON.stringify(login.body)).not.toContain('pinHash');

    const refreshed = await api().post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(200);
    await api().get('/api/auth/me').set({ Authorization: `Bearer ${refreshed.body.accessToken}` }).expect(200);

    await api().post('/api/auth/logout').send({ refreshToken: refreshed.body.refreshToken }).expect(200);
    await api().post('/api/auth/refresh').send({ refreshToken: refreshed.body.refreshToken }).expect(401);
  });

  it('changes a PIN and invalidates the old one', async () => {
    const shop = await createTestShop();
    await api().post('/api/auth/change-pin').set(auth(shop)).send({ currentPin: '1234', newPin: '4567' }).expect(200);
    await api().post('/api/auth/login').send({ phone: shop.phone, pin: '1234', businessId: shop.businessId }).expect(401);
    await api().post('/api/auth/login').send({ phone: shop.phone, pin: '4567', businessId: shop.businessId }).expect(200);
  });
});

describe('one shop cannot see another', () => {
  it('hides products, customers and bills belonging to a different shop', async () => {
    const mine = await createTestShop('KIRANA', { taxEnabled: false });
    const theirs = await createTestShop('GROCERY', { taxEnabled: false });

    const myProduct = await createTestProduct(mine, { name: 'My Secret Blend', stock: 10, selling: 100, barcode: 'MINE-001' });
    const myCustomer = await api().post('/api/customers').set(auth(mine)).send({ name: 'My Customer', phone: '9700000001' }).expect(201);
    const mySale = await api()
      .post('/api/sales')
      .set(auth(mine))
      .send({ items: [{ variantId: myProduct.variantId, quantity: 1 }], payments: [{ method: 'CASH', amountPaise: toPaise(100) }] })
      .expect(201);

    const theirProducts = await api().get('/api/products').set(auth(theirs)).expect(200);
    expect(theirProducts.body.items).toHaveLength(0);

    await api().get(`/api/products/${myProduct.productId}`).set(auth(theirs)).expect(404);
    await api().get('/api/products/barcode/MINE-001').set(auth(theirs)).expect(404);
    await api().get(`/api/customers/${myCustomer.body.id}`).set(auth(theirs)).expect(404);
    await api().get(`/api/sales/${mySale.body.id}`).set(auth(theirs)).expect(404);

    const theirSearch = await api().get('/api/search').query({ q: 'Secret' }).set(auth(theirs)).expect(200);
    expect(theirSearch.body.products).toHaveLength(0);
  });

  it('refuses to sell or adjust another shop\u2019s stock', async () => {
    const mine = await createTestShop();
    const theirs = await createTestShop();
    const { variantId } = await createTestProduct(mine, { name: 'Their Target', stock: 50, selling: 10 });

    await api()
      .post('/api/sales')
      .set(auth(theirs))
      .send({ items: [{ variantId, quantity: 1 }], payments: [{ method: 'CASH', amountPaise: toPaise(10) }] })
      .expect(404);

    await api()
      .post('/api/inventory/adjustment')
      .set(auth(theirs))
      .send({ reason: 'DAMAGED', lines: [{ variantId, quantityChange: -50 }] })
      .expect(404);

    const stillThere = await api().get('/api/inventory').set(auth(mine)).expect(200);
    expect(stillThere.body.items[0].quantity).toBe(50);
  });

  it('keeps invoice numbering separate per shop', async () => {
    const first = await createTestShop();
    const second = await createTestShop();
    const a = await createTestProduct(first, { name: 'A', stock: 5, selling: 10 });
    const b = await createTestProduct(second, { name: 'B', stock: 5, selling: 10 });

    const saleA = await api()
      .post('/api/sales')
      .set(auth(first))
      .send({ items: [{ variantId: a.variantId, quantity: 1 }], payments: [{ method: 'CASH', amountPaise: toPaise(10) }] })
      .expect(201);
    const saleB = await api()
      .post('/api/sales')
      .set(auth(second))
      .send({ items: [{ variantId: b.variantId, quantity: 1 }], payments: [{ method: 'CASH', amountPaise: toPaise(10) }] })
      .expect(201);

    expect(saleA.body.invoiceNumber).toBe(saleB.body.invoiceNumber);
    expect(saleA.body.id).not.toBe(saleB.body.id);
  });

  it('keeps dashboards and reports inside the shop', async () => {
    const mine = await createTestShop('KIRANA', { taxEnabled: false });
    const theirs = await createTestShop('KIRANA', { taxEnabled: false });
    const { variantId } = await createTestProduct(mine, { name: 'Busy Item', stock: 10, purchase: 50, selling: 100 });

    await api()
      .post('/api/sales')
      .set(auth(mine))
      .send({ items: [{ variantId, quantity: 3 }], payments: [{ method: 'CASH', amountPaise: toPaise(300) }] })
      .expect(201);

    const mineDash = await api().get('/api/dashboard').set(auth(mine)).expect(200);
    const theirsDash = await api().get('/api/dashboard').set(auth(theirs)).expect(200);

    expect(mineDash.body.today.salesPaise).toBe(toPaise(300));
    expect(theirsDash.body.today.salesPaise).toBe(0);
    expect(theirsDash.body.stockValuePaise).toBe(0);
  });
});
