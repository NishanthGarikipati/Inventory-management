import Dexie, { type Table } from 'dexie';
import type { CatalogueProduct, Party, SellableItem } from './types';

export type QueuedOperationType =
  | 'SALE'
  | 'PURCHASE'
  | 'ADJUSTMENT'
  | 'CUSTOMER_PAYMENT'
  | 'SUPPLIER_PAYMENT'
  | 'EXPENSE';

export interface QueuedOperation {
  clientRequestId: string;
  businessId: string;
  type: QueuedOperationType;
  payload: Record<string, unknown>;
  /** What to show in the pending list: "Bill ₹480 - Ramesh". */
  summary: string;
  queuedAt: string;
  attempts: number;
  lastError?: string;
  status: 'PENDING' | 'FAILED';
}

export interface CachedProduct extends CatalogueProduct {
  businessId: string;
}

export interface CachedStock {
  variantId: string;
  businessId: string;
  quantity: number;
  avgCostPaise: number;
}

export interface CachedParty extends Party {
  businessId: string;
  kind: 'CUSTOMER' | 'SUPPLIER';
  key: string;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * The phone's own copy of the shop. A sale written here is a real sale: it
 * is queued with a client request id and replayed until the server confirms
 * it, so nothing is lost when the network drops mid-billing.
 */
class DukaanDatabase extends Dexie {
  products!: Table<CachedProduct, string>;
  stock!: Table<CachedStock, string>;
  parties!: Table<CachedParty, string>;
  queue!: Table<QueuedOperation, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('dukaan');
    this.version(1).stores({
      products: 'id, businessId, name',
      stock: 'variantId, businessId',
      parties: 'key, businessId, [businessId+kind], name',
      queue: 'clientRequestId, businessId, status, queuedAt',
      meta: 'key',
    });
  }
}

export const db = new DukaanDatabase();

export async function readMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** Flattens the cached catalogue into the rows the POS searches. */
export async function cachedSellables(businessId: string): Promise<SellableItem[]> {
  const [products, stock] = await Promise.all([
    db.products.where('businessId').equals(businessId).toArray(),
    db.stock.where('businessId').equals(businessId).toArray(),
  ]);
  const stockByVariant = new Map(stock.map((row) => [row.variantId, row.quantity]));

  const items: SellableItem[] = [];
  for (const product of products) {
    if (!product.isActive) continue;
    for (const variant of product.variants) {
      items.push({
        variantId: variant.id,
        productId: product.id,
        name: variant.isDefault ? product.name : `${product.name} - ${variant.name}`,
        sku: variant.sku,
        barcode: variant.barcode,
        unit: product.unit,
        allowDecimal: product.allowDecimal,
        taxRate: product.taxRate,
        sellingPricePaise: variant.sellingPricePaise,
        mrpPaise: variant.mrpPaise,
        stock: stockByVariant.get(variant.id) ?? 0,
        trackBatch: product.trackBatch,
        trackSerial: product.trackSerial,
      });
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function clearBusinessCache(businessId: string): Promise<void> {
  await Promise.all([
    db.products.where('businessId').equals(businessId).delete(),
    db.stock.where('businessId').equals(businessId).delete(),
    db.parties.where('businessId').equals(businessId).delete(),
  ]);
}
