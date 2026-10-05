import { describe, expect, it } from 'vitest';
import { api, auth, createTestProduct, createTestShop } from './helpers.js';
import { toPaise } from '../domain/money.js';
import { prisma } from '../db/prisma.js';

describe('products', () => {
  it('creates a product with opening stock and a default variant', async () => {
    const shop = await createTestShop();
    const response = await api()
      .post('/api/products')
      .set(auth(shop))
      .send({
        name: 'Toor Dal 1KG',
        unitCode: 'KG',
        categoryName: 'Staples',
        brandName: 'Tata',
        purchasePricePaise: toPaise(120),
        sellingPricePaise: toPaise(140),
        mrpPaise: toPaise(150),
        minStock: 5,
        openingStock: 25,
      })
      .expect(201);

    expect(response.body.name).toBe('Toor Dal 1KG');
    expect(response.body.variants).toHaveLength(1);
    expect(response.body.variants[0].isDefault).toBe(true);
    expect(response.body.variants[0].sku).toBeTruthy();
    expect(response.body.totalStock).toBe(25);
    expect(response.body.category.name).toBe('Staples');
    expect(response.body.brand.name).toBe('Tata');
  });

  it('records opening stock as an OPENING inventory transaction', async () => {
    const shop = await createTestShop();
    const { variantId } = await createTestProduct(shop, { name: 'Sugar 1KG', stock: 40, purchase: 42 });

    const ledger = await api().get(`/api/inventory/ledger/${variantId}`).set(auth(shop)).expect(200);
    expect(ledger.body.transactions).toHaveLength(1);
    expect(ledger.body.transactions[0]).toMatchObject({
      type: 'OPENING',
      quantity: 40,
      previousStock: 0,
      newStock: 40,
    });
  });

  it('updates a product and writes a price change to the audit log', async () => {
    const shop = await createTestShop();
    const { productId } = await createTestProduct(shop, { name: 'Milk 1L', selling: 30 });

    const updated = await api()
      .put(`/api/products/${productId}`)
      .set(auth(shop))
      .send({ sellingPricePaise: toPaise(34), minStock: 10 })
      .expect(200);

    expect(updated.body.variants[0].sellingPricePaise).toBe(toPaise(34));
    expect(updated.body.variants[0].minStock).toBe(10);

    const audit = await api()
      .get('/api/audit')
      .query({ action: 'PRODUCT_PRICE_CHANGE' })
      .set(auth(shop))
      .expect(200);
    expect(audit.body.logs).toHaveLength(1);
    expect(audit.body.logs[0].before.sellingPricePaise).toBe(toPaise(30));
    expect(audit.body.logs[0].after.sellingPricePaise).toBe(toPaise(34));
  });

  it('finds a product by barcode and offers next steps when the barcode is unknown', async () => {
    const shop = await createTestShop();
    await createTestProduct(shop, { name: 'Parle G 250G', barcode: '8901234567890' });

    const found = await api().get('/api/products/barcode/8901234567890').set(auth(shop)).expect(200);
    expect(found.body.product.name).toBe('Parle G 250G');

    const missing = await api().get('/api/products/barcode/0000000000000').set(auth(shop)).expect(404);
    expect(missing.body.error.code).toBe('PRODUCT_NOT_FOUND');
    expect(missing.body.error.message).not.toMatch(/exception|null|undefined/i);
    expect(missing.body.error.actions.map((a: { action: string }) => a.action)).toEqual([
      'CREATE_PRODUCT',
      'SEARCH_PRODUCT',
    ]);
  });

  it('generates a barcode for a product that came without one', async () => {
    const shop = await createTestShop();
    const { variantId } = await createTestProduct(shop, { name: 'Loose Rice' });

    const generated = await api().post(`/api/products/variants/${variantId}/barcode`).set(auth(shop)).expect(200);
    expect(generated.body.barcode).toMatch(/^\d{12,13}$/);

    const lookup = await api().get(`/api/products/barcode/${generated.body.barcode}`).set(auth(shop)).expect(200);
    expect(lookup.body.product.name).toBe('Loose Rice');
  });

  it('warns before creating a probable duplicate and allows an explicit override', async () => {
    const shop = await createTestShop();
    await createTestProduct(shop, { name: 'Surf Excel Matic Front Load 2 Kg' });

    const warned = await api()
      .post('/api/products')
      .set(auth(shop))
      .send({ name: 'Surf Excel Matic 2KG', unitCode: 'PCS', sellingPricePaise: toPaise(430) })
      .expect(409);

    expect(warned.body.error.message).toContain('Surf Excel Matic Front Load 2 Kg');
    expect(warned.body.error.actions.map((a: { action: string }) => a.action)).toEqual([
      'USE_EXISTING',
      'CREATE_ANYWAY',
    ]);

    await api()
      .post('/api/products')
      .set(auth(shop))
      .send({
        name: 'Surf Excel Matic 2KG',
        unitCode: 'PCS',
        sellingPricePaise: toPaise(430),
        ignoreDuplicateWarning: true,
      })
      .expect(201);
  });

  it('refuses a duplicate barcode across products', async () => {
    const shop = await createTestShop();
    await createTestProduct(shop, { name: 'Colgate 200G', barcode: '8907777000011' });

    const clash = await api()
      .post('/api/products')
      .set(auth(shop))
      .send({
        name: 'Something Completely Different',
        unitCode: 'PCS',
        barcode: '8907777000011',
        ignoreDuplicateWarning: true,
      });

    expect(clash.status).toBeGreaterThanOrEqual(400);
    expect(clash.body.error.message).toBeTruthy();
  });

  it('matches an extracted name to an existing product without creating anything', async () => {
    const shop = await createTestShop();
    const { variantId } = await createTestProduct(shop, { name: 'Surf Excel Matic Front Load 2 Kg' });

    const before = await prisma.product.count({ where: { businessId: shop.businessId } });
    const match = await api()
      .post('/api/products/match')
      .set(auth(shop))
      .send({ name: 'Surf Excel Matic 2KG' })
      .expect(200);

    expect(match.body.best.variantId).toBe(variantId);
    expect(match.body.score).toBeGreaterThan(0.55);
    expect(await prisma.product.count({ where: { businessId: shop.businessId } })).toBe(before);
  });

  it('prefers a barcode match over a similar name', async () => {
    const shop = await createTestShop();
    await createTestProduct(shop, { name: 'Rice 5KG Premium', barcode: '8901111000001' });
    const { variantId } = await createTestProduct(shop, { name: 'Rice 5KG Economy', barcode: '8901111000002' });

    const match = await api()
      .post('/api/products/match')
      .set(auth(shop))
      .send({ name: 'Rice 5KG Premium', barcode: '8901111000002' })
      .expect(200);

    expect(match.body.method).toBe('BARCODE');
    expect(match.body.best.variantId).toBe(variantId);
  });

  it('keeps variant stock separate and searchable by its own barcode', async () => {
    const shop = await createTestShop();
    const created = await api()
      .post('/api/products')
      .set(auth(shop))
      .send({
        name: 'Cotton T-Shirt',
        unitCode: 'PCS',
        ignoreDuplicateWarning: true,
        variants: [
          { name: 'Red / S', barcode: 'TSHIRT-RED-S', sellingPricePaise: toPaise(399), openingStock: 4 },
          { name: 'Red / M', barcode: 'TSHIRT-RED-M', sellingPricePaise: toPaise(399), openingStock: 6 },
          { name: 'Blue / L', barcode: 'TSHIRT-BLU-L', sellingPricePaise: toPaise(449), openingStock: 2 },
        ],
      })
      .expect(201);

    expect(created.body.hasVariants).toBe(true);
    expect(created.body.variants).toHaveLength(3);
    expect(created.body.totalStock).toBe(12);

    const lookup = await api().get('/api/products/barcode/TSHIRT-RED-M').set(auth(shop)).expect(200);
    expect(lookup.body.product.name).toBe('Cotton T-Shirt - Red / M');
    expect(lookup.body.product.stock).toBe(6);
  });

  it('stores only the attributes configured for the business type', async () => {
    const pharmacy = await createTestShop('MEDICAL');
    const created = await api()
      .post('/api/products')
      .set(auth(pharmacy))
      .send({
        name: 'Paracetamol 500mg',
        unitCode: 'PCS',
        ignoreDuplicateWarning: true,
        trackBatch: true,
        trackExpiry: true,
        attributes: { composition: 'Paracetamol IP 500mg', manufacturer: 'Cipla', shade: 'Ruby' },
      })
      .expect(201);

    expect(created.body.attributes.composition).toBe('Paracetamol IP 500mg');
    expect(created.body.attributes.manufacturer).toBe('Cipla');
    // `shade` belongs to cosmetics, so a pharmacy never stores it.
    expect(created.body.attributes.shade).toBeUndefined();
  });

  it('deactivates instead of deleting so history stays readable', async () => {
    const shop = await createTestShop();
    const { productId } = await createTestProduct(shop, { name: 'Old Stock Item' });

    await api().delete(`/api/products/${productId}`).set(auth(shop)).expect(200);

    const visible = await api().get('/api/products').set(auth(shop)).expect(200);
    expect(visible.body.items.find((p: { id: string }) => p.id === productId)).toBeUndefined();

    const withInactive = await api().get('/api/products').query({ includeInactive: 'true' }).set(auth(shop)).expect(200);
    expect(withInactive.body.items.find((p: { id: string }) => p.id === productId)).toBeTruthy();
  });

  it('searches by name, sku and barcode', async () => {
    const shop = await createTestShop();
    await createTestProduct(shop, { name: 'Aashirvaad Atta 5KG', barcode: '8901030700123' });

    const byName = await api().get('/api/products').query({ search: 'atta' }).set(auth(shop)).expect(200);
    expect(byName.body.items).toHaveLength(1);

    const byBarcode = await api().get('/api/products').query({ search: '8901030700123' }).set(auth(shop)).expect(200);
    expect(byBarcode.body.items).toHaveLength(1);

    const global = await api().get('/api/search').query({ q: 'Aashirvaad' }).set(auth(shop)).expect(200);
    expect(global.body.products.length).toBeGreaterThan(0);
  });
});
