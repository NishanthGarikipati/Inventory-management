import { prisma, txOptions } from '../db/prisma.js';
import type { TenantScope } from '../db/tenant.js';
import { badRequest, notFound } from '../domain/errors.js';
import { roundQty } from '../domain/money.js';
import { applyStockMovement } from './inventory.service.js';
import { recordAudit } from './audit.service.js';
import { refreshStockAlerts } from './notification.service.js';

export interface RecipeInput {
  productId: string;
  name: string;
  yieldQty?: number;
  autoConsumeOnSale?: boolean;
  items: Array<{ variantId: string; quantity: number; note?: string }>;
}

/** Bakery and restaurant: what goes into one finished item. */
export async function createRecipe(scope: TenantScope, input: RecipeInput) {
  if (!input.items.length) throw badRequest('Add at least one ingredient.');

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: input.productId, businessId: scope.businessId },
    });
    if (!product) throw notFound('Product');

    const recipe = await tx.recipe.create({
      data: {
        businessId: scope.businessId,
        productId: product.id,
        name: input.name,
        yieldQty: input.yieldQty ?? 1,
        autoConsumeOnSale: input.autoConsumeOnSale ?? false,
      },
    });

    for (const item of input.items) {
      await tx.recipeItem.create({
        data: {
          recipeId: recipe.id,
          variantId: item.variantId,
          quantity: roundQty(item.quantity),
          note: item.note ?? null,
        },
      });
    }

    await tx.product.update({ where: { id: product.id }, data: { isComposite: true } });
    return tx.recipe.findUniqueOrThrow({ where: { id: recipe.id }, include: { items: true } });
  }, txOptions);
}

export async function listRecipes(scope: TenantScope) {
  return prisma.recipe.findMany({
    where: { businessId: scope.businessId, isActive: true },
    include: {
      product: { select: { id: true, name: true } },
      items: { include: { variant: { include: { product: { select: { name: true } } } } } },
    },
    orderBy: { name: 'asc' },
  });
}

/**
 * A production run: ingredients leave stock, finished goods enter it, and the
 * finished cost is the real cost of what was consumed.
 */
export async function recordProduction(
  scope: TenantScope,
  input: { recipeId: string; quantity: number; batchLabel?: string; expiryDate?: Date; note?: string },
) {
  if (input.quantity <= 0) throw badRequest('Enter how many you made.');

  const result = await prisma.$transaction(async (tx) => {
    const recipe = await tx.recipe.findFirst({
      where: { id: input.recipeId, businessId: scope.businessId },
      include: { items: true, product: { include: { variants: { where: { isDefault: true }, take: 1 } } } },
    });
    if (!recipe) throw notFound('Recipe');

    const outputVariant = recipe.product.variants[0];
    if (!outputVariant) throw badRequest('This product has no sellable item set up.');

    const production = await tx.production.create({
      data: {
        businessId: scope.businessId,
        recipeId: recipe.id,
        quantity: roundQty(input.quantity),
        batchLabel: input.batchLabel ?? null,
        note: input.note ?? null,
        userId: scope.userId || null,
      },
    });

    const batches = input.quantity / (recipe.yieldQty || 1);
    let ingredientCostPaise = 0;

    for (const ingredient of recipe.items) {
      const quantity = roundQty(ingredient.quantity * batches);
      const movement = await applyStockMovement(tx, scope, {
        variantId: ingredient.variantId,
        quantity: -quantity,
        type: 'CONSUMPTION',
        referenceType: 'PRODUCTION',
        referenceId: production.id,
        note: `Used for ${recipe.name}`,
      });
      ingredientCostPaise += movement.cogsPaise;

      await tx.productionItem.create({
        data: { productionId: production.id, variantId: ingredient.variantId, quantity, role: 'INGREDIENT' },
      });
    }

    let batchId: string | null = null;
    if (input.batchLabel) {
      const batch = await tx.batch.upsert({
        where: {
          businessId_variantId_batchNumber: {
            businessId: scope.businessId,
            variantId: outputVariant.id,
            batchNumber: input.batchLabel,
          },
        },
        create: {
          businessId: scope.businessId,
          variantId: outputVariant.id,
          batchNumber: input.batchLabel,
          expiryDate: input.expiryDate ?? null,
        },
        update: input.expiryDate ? { expiryDate: input.expiryDate } : {},
      });
      batchId = batch.id;
    }

    await applyStockMovement(tx, scope, {
      variantId: outputVariant.id,
      quantity: roundQty(input.quantity),
      type: 'PRODUCTION',
      unitCostPaise: input.quantity > 0 ? Math.round(ingredientCostPaise / input.quantity) : 0,
      batchId,
      referenceType: 'PRODUCTION',
      referenceId: production.id,
    });

    await tx.productionItem.create({
      data: { productionId: production.id, variantId: outputVariant.id, quantity: roundQty(input.quantity), role: 'OUTPUT' },
    });

    await recordAudit(tx, scope, {
      action: 'PRODUCTION_RECORDED',
      entityType: 'Production',
      entityId: production.id,
      after: { recipe: recipe.name, quantity: input.quantity, ingredientCostPaise },
    });

    return {
      production,
      ingredientCostPaise,
      touched: [outputVariant.id, ...recipe.items.map((i) => i.variantId)],
    };
  }, txOptions);

  await refreshStockAlerts(scope.businessId, result.touched);
  return result.production;
}

export async function recordWastage(
  scope: TenantScope,
  input: { variantId: string; quantity: number; reason: string },
) {
  if (input.quantity <= 0) throw badRequest('Enter how much was wasted.');

  return prisma.$transaction(async (tx) => {
    const movement = await applyStockMovement(
      tx,
      scope,
      {
        variantId: input.variantId,
        quantity: -roundQty(input.quantity),
        type: 'DAMAGE',
        referenceType: 'WASTAGE',
        note: input.reason,
      },
      { allowNegativeStock: true },
    );

    const wastage = await tx.wastage.create({
      data: {
        businessId: scope.businessId,
        variantId: input.variantId,
        quantity: roundQty(input.quantity),
        reason: input.reason,
        costPaise: movement.cogsPaise,
        userId: scope.userId || null,
      },
    });

    await recordAudit(tx, scope, {
      action: 'WASTAGE_RECORDED',
      entityType: 'Wastage',
      entityId: wastage.id,
      after: { quantity: input.quantity, reason: input.reason, costPaise: movement.cogsPaise },
    });

    return wastage;
  }, txOptions);
}

export async function listProductions(scope: TenantScope, limit = 50) {
  return prisma.production.findMany({
    where: { businessId: scope.businessId },
    include: { items: { include: { variant: { include: { product: { select: { name: true } } } } } } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, limit),
  });
}

export async function listWastage(scope: TenantScope, limit = 50) {
  return prisma.wastage.findMany({
    where: { businessId: scope.businessId },
    include: { variant: { include: { product: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, limit),
  });
}
