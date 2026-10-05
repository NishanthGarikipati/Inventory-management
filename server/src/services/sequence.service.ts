import type { Db } from '../db/prisma.js';

/**
 * Document numbers (INV-000123) are handed out inside the caller's
 * transaction so a rolled back sale never burns a number.
 */
export async function nextDocumentNumber(
  db: Db,
  businessId: string,
  key: 'INVOICE' | 'SALES_RETURN' | 'PURCHASE_RETURN' | 'PURCHASE',
  defaultPrefix: string,
): Promise<string> {
  const existing = await db.documentSequence.findUnique({
    where: { businessId_key: { businessId, key } },
  });

  if (!existing) {
    const created = await db.documentSequence.create({
      data: { businessId, key, prefix: defaultPrefix, nextValue: 2 },
    });
    return format(created.prefix, 1);
  }

  const updated = await db.documentSequence.update({
    where: { id: existing.id },
    data: { nextValue: { increment: 1 } },
  });
  return format(existing.prefix || defaultPrefix, updated.nextValue - 1);
}

const format = (prefix: string, value: number): string =>
  `${prefix}-${String(value).padStart(5, '0')}`;
