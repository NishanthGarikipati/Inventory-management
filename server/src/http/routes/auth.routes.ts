import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { authenticate, requirePermission, scopeOf } from '../middleware/auth.js';
import {
  businessTypeCatalogue,
  changePin,
  createStaffUser,
  login,
  logout,
  refreshSession,
  registerBusiness,
  sanitizeUser,
} from '../../services/auth.service.js';
import { prisma } from '../../db/prisma.js';
import { ROLE_DESCRIPTIONS, ROLE_PERMISSIONS, PERMISSIONS } from '../../domain/permissions.js';
import { USER_ROLES } from '../../domain/enums.js';
import { resolveFeatures } from '../../domain/businessTypes.js';

export const authRouter: Router = Router();

authRouter.get(
  '/business-types',
  asyncHandler(async (_req, res) => {
    res.json({ businessTypes: businessTypeCatalogue() });
  }),
);

authRouter.get(
  '/roles',
  asyncHandler(async (_req, res) => {
    res.json({
      roles: USER_ROLES.map((code) => ({
        code,
        ...ROLE_DESCRIPTIONS[code],
        permissions: ROLE_PERMISSIONS[code],
      })),
      permissions: PERMISSIONS,
    });
  }),
);

const registerSchema = z.object({
  businessName: z.string().min(2, 'Please enter your shop name'),
  ownerName: z.string().min(2, 'Please enter your name'),
  phone: z.string().min(10, 'Please enter a 10 digit mobile number').max(15),
  email: z.string().email().optional(),
  address: z.string().max(400).optional(),
  gstin: z.string().max(20).optional(),
  businessType: z.string(),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits'),
  currency: z.string().length(3).optional(),
  country: z.string().length(2).optional(),
  taxEnabled: z.boolean().optional(),
  pricesIncludeTax: z.boolean().optional(),
  defaultTaxRate: z.number().min(0).max(100).optional(),
});

authRouter.post(
  '/register',
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const result = await registerBusiness(req.body);
    res.status(201).json(result);
  }),
);

authRouter.post(
  '/login',
  validateBody(
    z.object({
      phone: z.string().min(4),
      pin: z.string().min(4).max(6),
      businessId: z.string().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(await login(req.body.phone, req.body.pin, req.body.businessId));
  }),
);

authRouter.post(
  '/refresh',
  validateBody(z.object({ refreshToken: z.string().min(10) })),
  asyncHandler(async (req, res) => {
    res.json(await refreshSession(req.body.refreshToken));
  }),
);

authRouter.post(
  '/logout',
  validateBody(z.object({ refreshToken: z.string().min(10) })),
  asyncHandler(async (req, res) => {
    await logout(req.body.refreshToken);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const [user, business, settings] = await Promise.all([
      prisma.user.findUnique({ where: { id: scope.userId } }),
      prisma.business.findUnique({ where: { id: scope.businessId } }),
      prisma.businessSettings.findUnique({ where: { businessId: scope.businessId } }),
    ]);
    res.json({
      user: user ? sanitizeUser(user) : null,
      business,
      settings,
      permissions: ROLE_PERMISSIONS[scope.role as keyof typeof ROLE_PERMISSIONS] ?? [],
      features: resolveFeatures(business?.businessType ?? '', settings?.featureOverrides),
    });
  }),
);

authRouter.post(
  '/change-pin',
  authenticate,
  validateBody(z.object({ currentPin: z.string(), newPin: z.string().regex(/^\d{4,6}$/) })),
  asyncHandler(async (req, res) => {
    await changePin(scopeOf(req).userId, req.body.currentPin, req.body.newPin);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/users',
  authenticate,
  requirePermission('user:manage'),
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { businessId: scopeOf(req).businessId },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ users: users.map(sanitizeUser) });
  }),
);

authRouter.post(
  '/users',
  authenticate,
  requirePermission('user:manage'),
  validateBody(
    z.object({
      name: z.string().min(2),
      phone: z.string().min(10).max(15),
      pin: z.string().regex(/^\d{4,6}$/),
      role: z.enum(USER_ROLES),
      email: z.string().email().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createStaffUser(scopeOf(req).businessId, req.body));
  }),
);

authRouter.patch(
  '/users/:id',
  authenticate,
  requirePermission('user:manage'),
  validateBody(z.object({ isActive: z.boolean().optional(), role: z.enum(USER_ROLES).optional(), name: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const result = await prisma.user.updateMany({
      where: { id: req.params.id, businessId: scope.businessId },
      data: req.body,
    });
    res.json({ updated: result.count });
  }),
);
