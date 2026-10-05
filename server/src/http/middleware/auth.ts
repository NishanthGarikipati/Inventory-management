import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { forbidden, unauthorized } from '../../domain/errors.js';
import { roleHasPermission, type Permission } from '../../domain/permissions.js';
import type { UserRole } from '../../domain/enums.js';
import type { TenantScope } from '../../db/tenant.js';

export interface AuthTokenPayload {
  sub: string;
  businessId: string;
  role: UserRole;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthTokenPayload;
      scope?: TenantScope;
    }
  }
}

export function signAccessToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.accessTokenTtlSeconds });
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized('Please sign in to continue.'));
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as AuthTokenPayload;
    req.auth = payload;
    req.scope = { businessId: payload.businessId, userId: payload.sub, role: payload.role };
    next();
  } catch {
    next(unauthorized('Your session has expired. Please sign in again.'));
  }
}

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const role = req.auth?.role;
    if (!role) return next(unauthorized());
    const allowed = permissions.every((permission) => roleHasPermission(role, permission));
    if (!allowed) {
      return next(
        forbidden(`Your role (${role.toLowerCase()}) cannot do this. Ask the owner for access.`),
      );
    }
    next();
  };
}

/** Convenience for routes that need the scope but not a specific permission. */
export function scopeOf(req: Request): TenantScope {
  if (!req.scope) throw unauthorized();
  return req.scope;
}
