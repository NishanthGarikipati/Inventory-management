import { AppError } from '../domain/errors.js';

/**
 * Multi-tenancy guard. Every query for business-owned data must go through a
 * scope built here, so a missing businessId is a loud failure instead of a
 * silent cross-business data leak.
 */
export interface TenantScope {
  businessId: string;
  userId: string;
  role: string;
}

export function requireBusinessId(businessId: string | undefined | null): string {
  if (!businessId) {
    throw new AppError(500, 'TENANT_SCOPE_MISSING', 'Something went wrong. Please try again.');
  }
  return businessId;
}

/** Shorthand for `where` clauses: `where: tenantWhere(scope, { id })`. */
export function tenantWhere<T extends Record<string, unknown>>(
  scope: TenantScope,
  where: T = {} as T,
): T & { businessId: string } {
  return { ...where, businessId: requireBusinessId(scope.businessId) };
}

/**
 * Verifies a row that was fetched by primary key really belongs to the caller's
 * business before it is used or returned.
 */
export function assertSameBusiness(
  scope: TenantScope,
  row: { businessId?: string } | null | undefined,
  what: string,
): void {
  if (!row || row.businessId !== scope.businessId) {
    throw new AppError(404, 'NOT_FOUND', `${what} was not found.`);
  }
}
