import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { addStaff, api, auth, createTestProduct, createTestShop, stockOf, testApp } from './helpers.js';
import { prisma } from '../db/prisma.js';
import { toPaise } from '../domain/money.js';
import { renderTextPng } from '../seed/textImage.js';
import { sampleByKey } from '../seed/sampleDocuments.js';

type Shop = Awaited<ReturnType<typeof createTestShop>>;

/**
 * Uploads a rendered document and runs it through the read pipeline, the way
 * the phone does: the photo plus whatever text the device managed to read.
 */
function scan(
  shop: Shop,
  sampleKey: string,
  options: { as?: { token: string }; lines?: string[]; scanType?: string } = {},
): request.Test {
  const sample = sampleByKey(sampleKey);
  if (!sample) throw new Error(`Unknown sample document: ${sampleKey}`);
  const lines = options.lines ?? sample.lines;
  const image = renderTextPng(lines);

  const req = request(testApp())
    .post('/api/scanner/scan')
    .set(auth(options.as ?? shop))
    .field('scanType', options.scanType ?? sample.scanType)
    .field('ocrText', lines.join('\n'));

  if (sample.barcodes?.length) req.field('barcodes', JSON.stringify(sample.barcodes));

  return req.attach('image', image, { filename: `${sampleKey}.png`, contentType: 'image/png' });
}

describe('smart scanner: reading a document', () => {
  it('reads a supplier invoice into lines the owner can check', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    await createTestProduct(shop, { name: 'Rice 5KG', stock: 5, purchase: 290 });
    await createTestProduct(shop, { name: 'Sugar 1KG', stock: 10, purchase: 43 });

    const response = await scan(shop, 'invoice-abc-distributors').expect(201);

    expect(response.body.status).toBe('REVIEW_REQUIRED');
    expect(response.body.extractedSupplierName).toMatch(/ABC DISTRIBUTORS/i);
    expect(response.body.invoiceNumber).toBe('INV-12345');
    expect(response.body.items.length).toBeGreaterThanOrEqual(4);

    const rice = response.body.items.find((i: { extractedProductName: string }) =>
      /rice/i.test(i.extractedProductName),
    );
    expect(rice.quantity).toBe(20);
    expect(rice.purchasePricePaise).toBe(toPaise(300));
    expect(rice.confidence).toBeGreaterThan(0);
    expect(rice.confidence).toBeLessThanOrEqual(1);
  });

  it('matches read lines to existing products instead of proposing duplicates', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    await createTestProduct(shop, { name: 'Rice 5KG', stock: 5, purchase: 290 });
    await createTestProduct(shop, { name: 'Sugar 1KG', stock: 10, purchase: 43 });

    const response = await scan(shop, 'invoice-abc-distributors').expect(201);
    const rice = response.body.items.find((i: { extractedProductName: string }) =>
      /rice/i.test(i.extractedProductName),
    );

    expect(rice.matchedProductName).toBe('Rice 5KG');
    expect(rice.matchMethod).not.toBe('NONE');
    expect(rice.createNewProduct).toBe(false);
    expect(rice.currentStock).toBe(5);
  });

  it('proposes a new product only when nothing in the shop is close', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    await createTestProduct(shop, { name: 'Rice 5KG', stock: 5 });

    const response = await scan(shop, 'invoice-sharma-traders').expect(201);
    const surf = response.body.items.find((i: { extractedProductName: string }) =>
      /surf/i.test(i.extractedProductName),
    );

    expect(surf.matchedVariantId).toBeNull();
    expect(surf.createNewProduct).toBe(true);
    expect(surf.matchBand).toBe('LOW');
  });

  it('prefers a barcode read by the camera over a similar looking name', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const decoy = await createTestProduct(shop, { name: 'Aashirvaad Atta 10KG', stock: 2 });
    const real = await createTestProduct(shop, {
      name: 'Aashirvaad Select Atta',
      stock: 3,
      barcode: '8901030865278',
    });

    const response = await scan(shop, 'product-label-atta').expect(201);
    const item = response.body.items[0];

    expect(item.matchMethod).toBe('BARCODE');
    expect(item.matchedVariantId).toBe(real.variantId);
    expect(item.matchedVariantId).not.toBe(decoy.variantId);
  });

  it('reads brand, size, MRP, batch and expiry from a product label', async () => {
    const shop = await createTestShop();
    const response = await scan(shop, 'product-label-atta').expect(201);
    const item = response.body.items[0];

    expect(item.extractedProductName).toMatch(/AASHIRVAAD/i);
    expect(item.extractedProductName).toMatch(/5 ?KG/i);
    expect(item.mrpPaise).toBe(toPaise(320));
    expect(item.batch).toBe('AT2291');
    expect(new Date(item.expiry).getFullYear()).toBe(2027);
    expect(new Date(item.expiry).getMonth()).toBe(7);
    expect(item.barcode).toBe('8901030865278');
  });

  it('reads a handwritten stock sheet as counted quantities', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    await createTestProduct(shop, { name: 'Rice 5KG', stock: 12 });
    await createTestProduct(shop, { name: 'Sugar 1KG', stock: 30 });

    const response = await scan(shop, 'stock-sheet-handwritten').expect(201);
    expect(response.body.scanType).toBe('STOCK_SHEET');
    const rice = response.body.items.find((i: { extractedProductName: string }) =>
      /rice/i.test(i.extractedProductName),
    );
    expect(rice.quantity).toBe(20);
    // Handwriting is never treated as certain.
    expect(response.body.overallConfidence).toBeLessThan(0.9);
  });

  it('tells the owner to retake a photo that cannot be read', async () => {
    const shop = await createTestShop();
    const tiny = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

    const response = await request(testApp())
      .post('/api/scanner/scan')
      .set(auth(shop))
      .field('scanType', 'INVOICE')
      .attach('image', tiny, { filename: 'blurry.jpg', contentType: 'image/jpeg' })
      .expect(422);

    expect(response.body.error.code).toBe('POOR_IMAGE_QUALITY');
    expect(response.body.error.actions.map((a: { action: string }) => a.action)).toEqual([
      'RETAKE',
      'MANUAL_ENTRY',
    ]);
    // A failed read still leaves a record, so nothing disappears silently.
    const stored = await prisma.imageScan.findFirstOrThrow({ where: { id: response.body.scanId } });
    expect(stored.status).toBe('FAILED');
  });

  it('refuses the same photo twice so one invoice cannot become two purchases', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    await scan(shop, 'invoice-abc-distributors').expect(201);

    const again = await scan(shop, 'invoice-abc-distributors').expect(409);
    expect(again.body.error.message).toMatch(/already scanned/i);
    expect(again.body.error.actions.map((a: { action: string }) => a.action)).toContain('OPEN_SCAN');
  });

  it('keeps the read of one shop invisible to another', async () => {
    const mine = await createTestShop('KIRANA', { taxEnabled: false });
    const theirs = await createTestShop('KIRANA', { taxEnabled: false });
    const scanned = await scan(mine, 'invoice-abc-distributors').expect(201);

    await api().get(`/api/scanner/${scanned.body.id}`).set(auth(theirs)).expect(404);
    const theirList = await api().get('/api/scanner').set(auth(theirs)).expect(200);
    expect(theirList.body.scans).toHaveLength(0);
  });
});

describe('smart scanner: the AI can never touch stock on its own', () => {
  it('changes nothing in the shop just by reading an invoice', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const rice = await createTestProduct(shop, { name: 'Rice 5KG', stock: 5, purchase: 290 });

    const productsBefore = await prisma.product.count({ where: { businessId: shop.businessId } });
    const transactionsBefore = await prisma.inventoryTransaction.count({ where: { businessId: shop.businessId } });
    const purchasesBefore = await prisma.purchase.count({ where: { businessId: shop.businessId } });
    const suppliersBefore = await prisma.supplier.count({ where: { businessId: shop.businessId } });

    const scanned = await scan(shop, 'invoice-abc-distributors').expect(201);
    expect(scanned.body.status).toBe('REVIEW_REQUIRED');

    expect(await stockOf(rice.variantId)).toBe(5);
    expect(await prisma.product.count({ where: { businessId: shop.businessId } })).toBe(productsBefore);
    expect(await prisma.inventoryTransaction.count({ where: { businessId: shop.businessId } })).toBe(
      transactionsBefore,
    );
    expect(await prisma.purchase.count({ where: { businessId: shop.businessId } })).toBe(purchasesBefore);
    expect(await prisma.supplier.count({ where: { businessId: shop.businessId } })).toBe(suppliersBefore);
  });

  it('will not confirm a line that is still waiting for the owner to fill in', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    await createTestProduct(shop, { name: 'Rice 5KG', stock: 5, purchase: 290 });
    const scanned = await scan(shop, 'invoice-abc-distributors').expect(201);
    const item = scanned.body.items[0];

    await api()
      .post(`/api/scanner/${scanned.body.id}/review`)
      .set(auth(shop))
      .send({ corrections: [{ itemId: item.id, reviewState: 'NEEDS_INPUT' }] })
      .expect(200);

    const blocked = await api()
      .post(`/api/scanner/${scanned.body.id}/approve`)
      .set(auth(shop))
      .send({ acceptedItemIds: [item.id] })
      .expect(400);

    expect(blocked.body.error.message).toMatch(/missing details/i);
    expect(blocked.body.error.actions[0].action).toBe('EDIT_ITEMS');
    expect(await prisma.purchase.count({ where: { businessId: shop.businessId } })).toBe(0);
  });

  it('blocks a line whose quantity could not be read at all', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    await createTestProduct(shop, { name: 'Rice 5KG', stock: 5, purchase: 290 });
    const scanned = await scan(shop, 'invoice-abc-distributors').expect(201);
    const item = scanned.body.items[0];

    // A vision model that returns no quantity must not be able to slip a line
    // through: validation at approval re-reads the row from the database.
    await prisma.imageScanItem.update({ where: { id: item.id }, data: { quantity: null } });

    const blocked = await api()
      .post(`/api/scanner/${scanned.body.id}/approve`)
      .set(auth(shop))
      .send({ acceptedItemIds: [item.id] })
      .expect(400);

    expect(blocked.body.error.message).toMatch(/could not read the quantity/i);
    expect(await prisma.purchase.count({ where: { businessId: shop.businessId } })).toBe(0);
  });

  it('requires a product decision for every line before it can be confirmed', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const scanned = await scan(shop, 'invoice-sharma-traders').expect(201);
    const item = scanned.body.items[0];

    // Say "this is not a new product" without choosing an existing one.
    await api()
      .post(`/api/scanner/${scanned.body.id}/review`)
      .set(auth(shop))
      .send({ corrections: [{ itemId: item.id, createNewProduct: false, matchedVariantId: null }] })
      .expect(200);

    const blocked = await api()
      .post(`/api/scanner/${scanned.body.id}/approve`)
      .set(auth(shop))
      .send({ acceptedItemIds: [item.id] })
      .expect(400);

    expect(blocked.body.error.message).toMatch(/choose a product/i);
    expect(blocked.body.error.actions.map((a: { action: string }) => a.action)).toEqual([
      'SELECT_PRODUCT',
      'CREATE_PRODUCT',
    ]);
  });

  it('re-checks the numbers at the moment of confirmation, not just when read', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const rice = await createTestProduct(shop, { name: 'Rice 5KG', stock: 5, purchase: 290 });
    const scanned = await scan(shop, 'invoice-abc-distributors').expect(201);
    const item = scanned.body.items.find((i: { extractedProductName: string }) =>
      /rice/i.test(i.extractedProductName),
    );

    // Somebody puts an impossible quantity straight into the row.
    await prisma.imageScanItem.update({ where: { id: item.id }, data: { quantity: -5 } });

    const blocked = await api()
      .post(`/api/scanner/${scanned.body.id}/approve`)
      .set(auth(shop))
      .send({ acceptedItemIds: [item.id] })
      .expect(400);

    expect(blocked.body.error.message).toMatch(/more than zero/i);
    expect(await stockOf(rice.variantId)).toBe(5);
    expect(await prisma.purchase.count({ where: { businessId: shop.businessId } })).toBe(0);
  });

  it('only lets a user with confirm rights push a scan into stock', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    await createTestProduct(shop, { name: 'Rice 5KG', stock: 5, purchase: 290 });
    const cashier = await addStaff(shop, 'CASHIER');

    const scanned = await scan(shop, 'invoice-abc-distributors', { as: cashier }).expect(201);
    const item = scanned.body.items[0];

    await api()
      .post(`/api/scanner/${scanned.body.id}/approve`)
      .set(auth(cashier))
      .send({ acceptedItemIds: [item.id] })
      .expect(403);

    expect(await prisma.purchase.count({ where: { businessId: shop.businessId } })).toBe(0);
  });

  it('cannot be confirmed twice, so one invoice cannot double the stock', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const rice = await createTestProduct(shop, { name: 'Rice 5KG', stock: 5, purchase: 290 });
    const scanned = await scan(shop, 'invoice-abc-distributors').expect(201);
    const riceItem = scanned.body.items.find((i: { extractedProductName: string }) =>
      /rice/i.test(i.extractedProductName),
    );

    await api()
      .post(`/api/scanner/${scanned.body.id}/approve`)
      .set(auth(shop))
      .send({ acceptedItemIds: [riceItem.id] })
      .expect(200);

    expect(await stockOf(rice.variantId)).toBe(25);

    const again = await api()
      .post(`/api/scanner/${scanned.body.id}/approve`)
      .set(auth(shop))
      .send({ acceptedItemIds: [riceItem.id] })
      .expect(409);

    expect(again.body.error.message).toMatch(/already confirmed/i);
    expect(await stockOf(rice.variantId)).toBe(25);
  });
});

describe('smart scanner: confirming a scan', () => {
  it('turns a confirmed invoice into a purchase with proper stock transactions', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const rice = await createTestProduct(shop, { name: 'Rice 5KG', stock: 5, purchase: 290 });
    const sugar = await createTestProduct(shop, { name: 'Sugar 1KG', stock: 10, purchase: 43 });

    const scanned = await scan(shop, 'invoice-abc-distributors').expect(201);
    const chosen = scanned.body.items.filter((i: { matchedVariantId: string | null }) => i.matchedVariantId);
    expect(chosen.length).toBeGreaterThanOrEqual(2);

    const approved = await api()
      .post(`/api/scanner/${scanned.body.id}/approve`)
      .set(auth(shop))
      .send({
        acceptedItemIds: chosen.map((i: { id: string }) => i.id),
        payment: { method: 'CASH', amountPaise: toPaise(2000) },
      })
      .expect(200);

    expect(approved.body.resultRefType).toBe('Purchase');
    expect(approved.body.scan.status).toBe('APPROVED');

    expect(await stockOf(rice.variantId)).toBe(25);
    expect(await stockOf(sugar.variantId)).toBe(40);

    const ledger = await api().get(`/api/inventory/ledger/${rice.variantId}`).set(auth(shop)).expect(200);
    expect(ledger.body.transactions[0]).toMatchObject({
      type: 'PURCHASE',
      quantity: 20,
      source: 'IMAGE_SCAN',
      referenceType: 'PURCHASE',
    });

    const purchase = await api().get(`/api/purchases/${approved.body.resultRefId}`).set(auth(shop)).expect(200);
    expect(purchase.body.invoiceNumber).toBe('INV-12345');
    expect(purchase.body.supplier.name).toMatch(/ABC DISTRIBUTORS/i);
    expect(purchase.body.source).toBe('IMAGE_SCAN');
    expect(purchase.body.imageScanId).toBe(scanned.body.id);
    expect(purchase.body.supplier.balancePaise).toBeGreaterThan(0);
  });

  it('only brings in the lines the owner ticked', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const rice = await createTestProduct(shop, { name: 'Rice 5KG', stock: 5, purchase: 290 });
    const sugar = await createTestProduct(shop, { name: 'Sugar 1KG', stock: 10, purchase: 43 });

    const scanned = await scan(shop, 'invoice-abc-distributors').expect(201);
    const riceItem = scanned.body.items.find((i: { extractedProductName: string }) =>
      /rice/i.test(i.extractedProductName),
    );

    await api()
      .post(`/api/scanner/${scanned.body.id}/approve`)
      .set(auth(shop))
      .send({ acceptedItemIds: [riceItem.id] })
      .expect(200);

    expect(await stockOf(rice.variantId)).toBe(25);
    expect(await stockOf(sugar.variantId)).toBe(10);

    const review = await api().get(`/api/scanner/${scanned.body.id}`).set(auth(shop)).expect(200);
    const states = review.body.items.map((i: { reviewState: string }) => i.reviewState);
    expect(states.filter((s: string) => s === 'ACCEPTED')).toHaveLength(1);
    expect(states.filter((s: string) => s === 'REJECTED').length).toBeGreaterThan(0);
  });

  it('keeps both the AI value and the owner\u2019s correction', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const rice = await createTestProduct(shop, { name: 'Rice 5KG', stock: 5, purchase: 290 });

    const scanned = await scan(shop, 'invoice-abc-distributors').expect(201);
    const item = scanned.body.items.find((i: { extractedProductName: string }) =>
      /rice/i.test(i.extractedProductName),
    );

    const reviewed = await api()
      .post(`/api/scanner/${scanned.body.id}/review`)
      .set(auth(shop))
      .send({
        corrections: [{ itemId: item.id, quantity: 18, purchasePricePaise: toPaise(305) }],
      })
      .expect(200);

    const corrected = reviewed.body.items.find((i: { id: string }) => i.id === item.id);
    expect(corrected.quantity).toBe(18);
    expect(corrected.userCorrected).toBe(true);

    const corrections = reviewed.body.corrections;
    expect(corrections.find((c: { field: string }) => c.field === 'quantity')).toMatchObject({
      originalValue: '20',
      correctedValue: '18',
    });

    const approved = await api()
      .post(`/api/scanner/${scanned.body.id}/approve`)
      .set(auth(shop))
      .send({ acceptedItemIds: [item.id] })
      .expect(200);

    expect(await stockOf(rice.variantId)).toBe(23);

    const audit = await api().get('/api/audit').query({ action: 'AI_SCAN_APPROVED' }).set(auth(shop)).expect(200);
    const entry = audit.body.logs[0].after;
    expect(entry.items[0].extracted.quantity).toBe(18);
    expect(entry.items[0].confirmed.quantity).toBe(18);
    expect(entry.corrections.find((c: { field: string }) => c.field === 'quantity')).toMatchObject({
      from: '20',
      to: '18',
    });
    expect(entry.imageRef).toBe(approved.body.scan.imageRef);
  });

  it('creates a product from a scan only when the owner asks for it', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const scanned = await scan(shop, 'invoice-sharma-traders').expect(201);
    const surf = scanned.body.items.find((i: { extractedProductName: string }) => /surf/i.test(i.extractedProductName));

    await api()
      .post(`/api/scanner/${scanned.body.id}/approve`)
      .set(auth(shop))
      .send({ acceptedItemIds: [surf.id], supplierName: 'Sharma Traders' })
      .expect(200);

    const created = await prisma.product.findFirstOrThrow({
      where: { businessId: shop.businessId, name: { contains: 'SURF' } },
      include: { variants: { include: { inventory: true } } },
    });
    expect(created.variants[0].inventory?.quantity).toBe(12);

    const audit = await api().get('/api/audit').query({ action: 'PRODUCT_CREATED' }).set(auth(shop)).expect(200);
    expect(audit.body.logs[0].source).toBe('IMAGE_SCAN');
  });

  it('treats a counted stock sheet as a difference, never an overwrite', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const rice = await createTestProduct(shop, { name: 'Rice 5KG', stock: 12 });
    const sugar = await createTestProduct(shop, { name: 'Sugar 1KG', stock: 30 });

    const scanned = await scan(shop, 'stock-sheet-handwritten').expect(201);
    const counted = scanned.body.items.filter((i: { matchedVariantId: string | null }) => i.matchedVariantId);

    const approved = await api()
      .post(`/api/scanner/${scanned.body.id}/approve`)
      .set(auth(shop))
      .send({ acceptedItemIds: counted.map((i: { id: string }) => i.id) })
      .expect(200);

    expect(approved.body.resultRefType).toBe('StockAdjustment');
    expect(await stockOf(rice.variantId)).toBe(20);
    expect(await stockOf(sugar.variantId)).toBe(15);

    const ledger = await api().get(`/api/inventory/ledger/${rice.variantId}`).set(auth(shop)).expect(200);
    expect(ledger.body.transactions[0]).toMatchObject({
      type: 'IMAGE_SCAN_ADJUSTMENT',
      quantity: 8,
      source: 'IMAGE_SCAN',
    });
  });

  it('updates catalogue details from a product label without moving stock', async () => {
    const shop = await createTestShop();
    const product = await createTestProduct(shop, {
      name: 'Aashirvaad Shudh Chakki Atta 5 KG',
      stock: 4,
      mrp: 300,
    });

    const scanned = await scan(shop, 'product-label-atta').expect(201);
    const item = scanned.body.items[0];

    await api()
      .post(`/api/scanner/${scanned.body.id}/review`)
      .set(auth(shop))
      .send({ corrections: [{ itemId: item.id, matchedVariantId: product.variantId }] })
      .expect(200);

    const approved = await api()
      .post(`/api/scanner/${scanned.body.id}/approve`)
      .set(auth(shop))
      .send({ acceptedItemIds: [item.id] })
      .expect(200);

    expect(approved.body.resultRefType).toBe('Product');
    expect(await stockOf(product.variantId)).toBe(4);

    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: product.variantId } });
    expect(variant.mrpPaise).toBe(toPaise(320));
    expect(variant.barcode).toBe('8901030865278');
  });

  it('cancels a scan without touching anything', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const rice = await createTestProduct(shop, { name: 'Rice 5KG', stock: 5 });
    const scanned = await scan(shop, 'invoice-abc-distributors').expect(201);

    const rejected = await api()
      .post(`/api/scanner/${scanned.body.id}/reject`)
      .set(auth(shop))
      .send({ reason: 'Wrong invoice' })
      .expect(200);

    expect(rejected.body.status).toBe('REJECTED');
    expect(await stockOf(rice.variantId)).toBe(5);
    expect(await prisma.purchase.count({ where: { businessId: shop.businessId } })).toBe(0);

    const audit = await api().get('/api/audit').query({ action: 'AI_SCAN_REJECTED' }).set(auth(shop)).expect(200);
    expect(audit.body.logs[0].after.reason).toBe('Wrong invoice');

    await api()
      .post(`/api/scanner/${scanned.body.id}/approve`)
      .set(auth(shop))
      .send({ acceptedItemIds: [scanned.body.items[0].id] })
      .expect(409);
  });

  it('clears the waiting-for-confirmation reminder once the scan is handled', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    const scanned = await scan(shop, 'invoice-abc-distributors').expect(201);

    const pending = await api().get('/api/notifications').set(auth(shop)).expect(200);
    const reminder = pending.body.notifications.find((n: { type: string }) => n.type === 'SCAN_REVIEW');
    expect(reminder.body).toMatch(/waiting|detected/i);

    await api().post(`/api/scanner/${scanned.body.id}/reject`).set(auth(shop)).send({ reason: 'Not mine' }).expect(200);

    const after = await api().get('/api/notifications').set(auth(shop)).expect(200);
    expect(after.body.notifications.find((n: { type: string }) => n.type === 'SCAN_REVIEW')).toBeUndefined();
  });

  it('keeps a readable history of what was read and what was confirmed', async () => {
    const shop = await createTestShop('KIRANA', { taxEnabled: false });
    await createTestProduct(shop, { name: 'Rice 5KG', stock: 5, purchase: 290 });
    const scanned = await scan(shop, 'invoice-abc-distributors').expect(201);
    const riceItem = scanned.body.items.find((i: { extractedProductName: string }) =>
      /rice/i.test(i.extractedProductName),
    );

    await api()
      .post(`/api/scanner/${scanned.body.id}/approve`)
      .set(auth(shop))
      .send({ acceptedItemIds: [riceItem.id] })
      .expect(200);

    const history = await api().get('/api/reports/scans').set(auth(shop)).expect(200);
    expect(history.body.totals).toMatchObject({ total: 1, approved: 1, pending: 0 });
    expect(history.body.scans[0]).toMatchObject({
      status: 'APPROVED',
      type: 'INVOICE',
      itemCount: 4,
      resultRefType: 'Purchase',
    });

    const detail = await api().get(`/api/scanner/${scanned.body.id}`).set(auth(shop)).expect(200);
    expect(detail.body.approvals).toHaveLength(1);
    expect(detail.body.approvals[0].approvedItems).toBe(1);
    expect(detail.body.approvals[0].approvedBy.id).toBe(shop.ownerId);
    // The pipeline stages are kept so a scan can be explained afterwards.
    expect(detail.body.results.map((r: { stage: string }) => r.stage)).toEqual(
      expect.arrayContaining(['QUALITY', 'OCR', 'VISION', 'VALIDATION', 'MATCHING']),
    );

    const image = await api().get(`/api/scanner/${scanned.body.id}/image`).set(auth(shop)).expect(200);
    expect(image.headers['content-type']).toContain('image/png');
  });
});
