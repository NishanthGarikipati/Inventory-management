import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma, txOptions, type Tx } from '../db/prisma.js';
import { config } from '../config.js';
import { AppError, badRequest, conflict, notFound, unauthorized } from '../domain/errors.js';
import { signAccessToken } from '../http/middleware/auth.js';
import { BUSINESS_TYPE_TEMPLATES, templateByCode } from '../domain/businessTypes.js';
import { EXPENSE_CATEGORIES, type UserRole } from '../domain/enums.js';
import { ROLE_PERMISSIONS } from '../domain/permissions.js';
import { normalizeName } from '../utils/text.js';

const PIN_ROUNDS = 10;

export interface RegisterBusinessInput {
  businessName: string;
  ownerName: string;
  phone: string;
  email?: string;
  address?: string;
  gstin?: string;
  businessType: string;
  pin: string;
  currency?: string;
  country?: string;
  taxEnabled?: boolean;
  pricesIncludeTax?: boolean;
  defaultTaxRate?: number;
}

/**
 * Onboarding in one call: business, settings, owner, and everything the chosen
 * industry needs to be usable immediately (units, taxes, categories, dynamic
 * attributes, expense heads).
 */
export async function registerBusiness(input: RegisterBusinessInput) {
  const template = templateByCode(input.businessType);
  if (!template) throw badRequest('Please choose a valid business type.');
  if (!/^\d{4,6}$/.test(input.pin)) throw badRequest('PIN must be 4 to 6 digits.');

  const pinHash = await bcrypt.hash(input.pin, PIN_ROUNDS);

  const result = await prisma.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: {
        name: input.businessName,
        ownerName: input.ownerName,
        phone: input.phone,
        email: input.email ?? null,
        address: input.address ?? null,
        gstin: input.gstin ?? null,
        businessType: template.code,
        currency: input.currency ?? 'INR',
        country: input.country ?? 'IN',
      },
    });

    await tx.businessSettings.create({
      data: {
        businessId: business.id,
        taxEnabled: input.taxEnabled ?? true,
        pricesIncludeTax: input.pricesIncludeTax ?? true,
        defaultTaxRate: input.defaultTaxRate ?? template.defaultTaxRates[0] ?? 0,
      },
    });

    const owner = await tx.user.create({
      data: {
        businessId: business.id,
        name: input.ownerName,
        phone: input.phone,
        email: input.email ?? null,
        pinHash,
        role: 'OWNER',
      },
    });

    await provisionBusinessDefaults(tx, business.id, template.code);

    return { business, owner };
  }, txOptions);

  const tokens = await issueTokens(result.owner.id, result.business.id, result.owner.role as UserRole, result.owner.name);
  return { business: result.business, user: sanitizeUser(result.owner), ...tokens };
}

/** Seeds units, conversions, taxes, categories, attributes and expense heads. */
export async function provisionBusinessDefaults(tx: Tx, businessId: string, businessTypeCode: string) {
  const template = templateByCode(businessTypeCode);
  if (!template) throw badRequest('Unknown business type.');

  const unitsByCode = new Map<string, string>();
  for (const unit of template.units) {
    const created = await tx.unit.create({
      data: {
        businessId,
        code: unit.code,
        name: unit.name,
        allowDecimal: unit.allowDecimal,
        isBase: ['PCS', 'KG', 'L', 'M'].includes(unit.code),
      },
    });
    unitsByCode.set(unit.code, created.id);
  }

  const conversions: Array<[string, string, number]> = [
    ['BOX', 'PCS', 100],
    ['PACK', 'PCS', 10],
    ['DOZEN', 'PCS', 12],
    ['KG', 'G', 1000],
    ['L', 'ML', 1000],
    ['STRIP', 'PCS', 10],
  ];
  for (const [from, to, factor] of conversions) {
    const fromId = unitsByCode.get(from);
    const toId = unitsByCode.get(to);
    if (fromId && toId) {
      await tx.unitConversion.create({ data: { businessId, fromUnitId: fromId, toUnitId: toId, factor } });
    }
  }

  const rates = template.defaultTaxRates.length ? template.defaultTaxRates : [0];
  for (const [index, rate] of rates.entries()) {
    await tx.tax.create({
      data: { businessId, name: rate === 0 ? 'No Tax' : `GST ${rate}%`, rate, isDefault: index === 0 },
    });
  }

  for (const name of template.categories) {
    await tx.category.create({ data: { businessId, name } });
  }

  for (const [index, attribute] of template.attributes.entries()) {
    await tx.productAttributeDefinition.create({
      data: {
        businessId,
        key: attribute.key,
        label: attribute.label,
        dataType: attribute.dataType,
        options: JSON.stringify(attribute.options ?? []),
        isRequired: attribute.isRequired ?? false,
        showInList: attribute.showInList ?? false,
        appliesToVariant: attribute.appliesToVariant ?? false,
        sortOrder: index,
      },
    });
  }

  for (const name of EXPENSE_CATEGORIES) {
    await tx.expenseCategory.create({ data: { businessId, name } });
  }

  await tx.documentSequence.createMany({
    data: [
      { businessId, key: 'INVOICE', prefix: 'INV', nextValue: 1 },
      { businessId, key: 'SALES_RETURN', prefix: 'SR', nextValue: 1 },
      { businessId, key: 'PURCHASE_RETURN', prefix: 'PR', nextValue: 1 },
    ],
  });
}

export async function login(phone: string, pin: string, businessId?: string) {
  const users = await prisma.user.findMany({
    where: { phone, isActive: true, ...(businessId ? { businessId } : {}) },
    include: { business: true },
  });
  if (!users.length) throw unauthorized('We could not find this mobile number. Please check and try again.');

  // Same number can own more than one shop; ask which one rather than guessing.
  if (users.length > 1 && !businessId) {
    const matches: typeof users = [];
    for (const user of users) {
      if (await bcrypt.compare(pin, user.pinHash)) matches.push(user);
    }
    if (matches.length !== 1) {
      throw new AppError(300, 'CHOOSE_BUSINESS', 'Please choose which shop you want to open.', {
        details: users.map((u) => ({ businessId: u.businessId, businessName: u.business.name })),
      });
    }
    return finishLogin(matches[0]);
  }

  const user = users[0];
  const ok = await bcrypt.compare(pin, user.pinHash);
  if (!ok) throw unauthorized('Wrong PIN. Please try again.');
  return finishLogin(user);
}

async function finishLogin(user: { id: string; businessId: string; role: string; name: string }) {
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const business = await prisma.business.findUnique({
    where: { id: user.businessId },
    include: { settings: true },
  });
  const tokens = await issueTokens(user.id, user.businessId, user.role as UserRole, user.name);
  return {
    business,
    user: { id: user.id, name: user.name, role: user.role, businessId: user.businessId },
    permissions: ROLE_PERMISSIONS[user.role as UserRole] ?? [],
    ...tokens,
  };
}

export async function issueTokens(userId: string, businessId: string, role: UserRole, name: string) {
  const accessToken = signAccessToken({ sub: userId, businessId, role, name });
  const refreshToken = crypto.randomBytes(32).toString('hex');
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + config.refreshTokenTtlSeconds * 1000),
    },
  });
  return { accessToken, refreshToken, expiresIn: config.accessTokenTtlSeconds };
}

export async function refreshSession(refreshToken: string) {
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: true },
  });
  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    throw unauthorized('Please sign in again.');
  }
  await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
  return issueTokens(record.user.id, record.user.businessId, record.user.role as UserRole, record.user.name);
}

export async function logout(refreshToken: string) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken) },
    data: { revokedAt: new Date() },
  });
}

export async function createStaffUser(
  businessId: string,
  input: { name: string; phone: string; pin: string; role: UserRole; email?: string },
) {
  if (!/^\d{4,6}$/.test(input.pin)) throw badRequest('PIN must be 4 to 6 digits.');
  const existing = await prisma.user.findFirst({ where: { businessId, phone: input.phone } });
  if (existing) throw conflict('This mobile number is already added to your shop.');
  const user = await prisma.user.create({
    data: {
      businessId,
      name: input.name,
      phone: input.phone,
      email: input.email ?? null,
      pinHash: await bcrypt.hash(input.pin, PIN_ROUNDS),
      role: input.role,
    },
  });
  return sanitizeUser(user);
}

export async function changePin(userId: string, currentPin: string, newPin: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('User');
  if (!(await bcrypt.compare(currentPin, user.pinHash))) throw unauthorized('Current PIN is wrong.');
  if (!/^\d{4,6}$/.test(newPin)) throw badRequest('PIN must be 4 to 6 digits.');
  await prisma.user.update({ where: { id: userId }, data: { pinHash: await bcrypt.hash(newPin, PIN_ROUNDS) } });
}

export function sanitizeUser<T extends { pinHash?: string }>(user: T): Omit<T, 'pinHash'> {
  const { pinHash: _pinHash, ...rest } = user;
  return rest;
}

export const businessTypeCatalogue = () =>
  BUSINESS_TYPE_TEMPLATES.map((t) => ({
    code: t.code,
    name: t.name,
    description: t.description,
    icon: t.icon,
    features: t.features,
    suggestedUnits: t.units.map((u) => u.code),
    categories: t.categories,
  }));

const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

export const normalizeForSearch = normalizeName;
