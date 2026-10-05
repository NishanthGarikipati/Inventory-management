import { api, ApiError } from './api';
import {
  cachedSellables,
  db,
  readMeta,
  writeMeta,
  type QueuedOperation,
  type QueuedOperationType,
} from './db';
import type { BusinessSettings, CatalogueProduct, Party, SellableItem } from './types';

interface PullResponse {
  syncedAt: string;
  business: { id: string; name: string } | null;
  settings: BusinessSettings | null;
  products: CatalogueProduct[];
  inventory: Array<{ variantId: string; quantity: number; avgCostPaise: number }>;
  customers: Party[];
  suppliers: Party[];
}

interface PushResult {
  clientRequestId: string;
  status: 'APPLIED' | 'DUPLICATE' | 'FAILED';
  error?: { code: string; message: string };
}

const lastSyncKey = (businessId: string) => `lastSync:${businessId}`;

/**
 * Pulls only what changed since the last successful sync, so a shop with a
 * large catalogue downloads it once and then trickles.
 */
export async function pullCatalogue(businessId: string, options: { full?: boolean } = {}): Promise<void> {
  const since = options.full ? undefined : await readMeta<string>(lastSyncKey(businessId));
  const data = await api.get<PullResponse>('/sync/pull', since ? { since } : undefined);

  await db.transaction('rw', db.products, db.stock, db.parties, db.meta, async () => {
    if (data.products.length) {
      await db.products.bulkPut(data.products.map((product) => ({ ...product, businessId })));
    }
    if (data.inventory.length) {
      await db.stock.bulkPut(data.inventory.map((row) => ({ ...row, businessId })));
    }
    if (data.customers.length) {
      await db.parties.bulkPut(
        data.customers.map((customer) => ({ ...customer, businessId, kind: 'CUSTOMER' as const, key: `C:${customer.id}` })),
      );
    }
    if (data.suppliers.length) {
      await db.parties.bulkPut(
        data.suppliers.map((supplier) => ({ ...supplier, businessId, kind: 'SUPPLIER' as const, key: `S:${supplier.id}` })),
      );
    }
    if (data.settings) await writeMeta(`settings:${businessId}`, data.settings);
    await writeMeta(lastSyncKey(businessId), data.syncedAt);
  });
}

export async function queueOperation(operation: Omit<QueuedOperation, 'attempts' | 'status' | 'queuedAt'>): Promise<void> {
  await db.queue.put({ ...operation, queuedAt: new Date().toISOString(), attempts: 0, status: 'PENDING' });
}

export async function pendingOperations(businessId: string): Promise<QueuedOperation[]> {
  return db.queue.where('businessId').equals(businessId).sortBy('queuedAt');
}

export async function pendingCount(businessId: string): Promise<number> {
  return db.queue.where('businessId').equals(businessId).count();
}

export async function discardOperation(clientRequestId: string): Promise<void> {
  await db.queue.delete(clientRequestId);
}

export interface PushSummary {
  applied: number;
  duplicates: number;
  failed: number;
  failures: Array<{ summary: string; message: string }>;
}

/**
 * Sends the queue. An operation is only removed once the server has taken it
 * (or recognised it as a replay). A rejected one stays on the phone with the
 * reason, so the owner can fix it instead of losing the sale.
 */
export async function pushQueue(businessId: string): Promise<PushSummary> {
  const queued = await pendingOperations(businessId);
  const summary: PushSummary = { applied: 0, duplicates: 0, failed: 0, failures: [] };
  if (!queued.length) return summary;

  const batches = chunk(queued, 50);
  for (const batch of batches) {
    let response: { results: PushResult[] };
    try {
      response = await api.post<{ results: PushResult[] }>('/sync/push', {
        operations: batch.map((operation) => ({
          clientRequestId: operation.clientRequestId,
          type: operation.type,
          payload: operation.payload,
          queuedAt: operation.queuedAt,
        })),
      });
    } catch (error) {
      if (error instanceof ApiError && error.isOffline) return summary;
      throw error;
    }

    for (const result of response.results) {
      const operation = batch.find((item) => item.clientRequestId === result.clientRequestId);
      if (result.status === 'FAILED') {
        summary.failed += 1;
        summary.failures.push({
          summary: operation?.summary ?? 'Saved transaction',
          message: result.error?.message ?? 'This could not be saved.',
        });
        await db.queue.update(result.clientRequestId, {
          status: 'FAILED',
          attempts: (operation?.attempts ?? 0) + 1,
          lastError: result.error?.message,
        });
        continue;
      }
      if (result.status === 'DUPLICATE') summary.duplicates += 1;
      else summary.applied += 1;
      await db.queue.delete(result.clientRequestId);
    }
  }

  return summary;
}

/** Retries operations the server previously rejected, after the owner fixed the cause. */
export async function retryFailed(businessId: string): Promise<PushSummary> {
  await db.queue.where('businessId').equals(businessId).modify({ status: 'PENDING' });
  return pushQueue(businessId);
}

/**
 * Applies a queued sale/adjustment to the cached stock straight away, so the
 * POS keeps showing the right number while the queue drains.
 */
export async function applyLocalStockDelta(
  businessId: string,
  deltas: Array<{ variantId: string; change: number }>,
): Promise<void> {
  await db.transaction('rw', db.stock, async () => {
    for (const delta of deltas) {
      const row = await db.stock.get(delta.variantId);
      if (!row) continue;
      await db.stock.put({ ...row, businessId, quantity: Number((row.quantity + delta.change).toFixed(3)) });
    }
  });
}

export async function localSellables(businessId: string): Promise<SellableItem[]> {
  return cachedSellables(businessId);
}

export const operationLabel: Record<QueuedOperationType, string> = {
  SALE: 'Bill',
  PURCHASE: 'Purchase',
  ADJUSTMENT: 'Stock update',
  CUSTOMER_PAYMENT: 'Customer payment',
  SUPPLIER_PAYMENT: 'Supplier payment',
  EXPENSE: 'Expense',
};

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
