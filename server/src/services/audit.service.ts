import type { Db } from '../db/prisma.js';
import type { TenantScope } from '../db/tenant.js';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
  source?: string;
}

/**
 * Every business-critical change is written here, including the full AI trail
 * (image id, raw extraction, confidence, user corrections, confirmed values).
 */
export async function recordAudit(db: Db, scope: TenantScope, input: AuditInput): Promise<void> {
  await db.auditLog.create({
    data: {
      businessId: scope.businessId,
      userId: scope.userId || null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: input.before === undefined ? null : JSON.stringify(input.before),
      after: input.after === undefined ? null : JSON.stringify(input.after),
      meta: input.meta === undefined ? null : JSON.stringify(input.meta),
      source: input.source ?? 'MANUAL',
    },
  });
}
