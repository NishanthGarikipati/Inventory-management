import type { Db } from '../db/prisma.js';
import type { MatchMethod } from '../domain/enums.js';
import { extractSizeToken, normalizeName, similarity } from '../utils/text.js';

export interface MatchCandidate {
  variantId: string;
  productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  score: number;
  method: MatchMethod;
  purchasePricePaise: number;
  sellingPricePaise: number;
  mrpPaise: number;
  currentStock: number;
}

export interface MatchQuery {
  name?: string | null;
  barcode?: string | null;
  sku?: string | null;
  brand?: string | null;
  size?: string | null;
}

export interface MatchOutcome {
  best: MatchCandidate | null;
  candidates: MatchCandidate[];
  method: MatchMethod;
  /** 0..1 - how sure we are that `best` is the same product. */
  score: number;
}

/** Below this a proposal must be treated as "probably a new product". */
export const FUZZY_MATCH_FLOOR = 0.55;
/** At or above this we can pre-select "use existing product" for the user. */
export const FUZZY_MATCH_STRONG = 0.82;

/**
 * Deterministic product matching used both by the smart scanner and by
 * duplicate prevention when a product is created by hand. The order of checks
 * is deliberate: a barcode is hard evidence, a fuzzy name is a suggestion.
 */
export async function matchProduct(
  db: Db,
  businessId: string,
  query: MatchQuery,
  options: { limit?: number } = {},
): Promise<MatchOutcome> {
  const limit = options.limit ?? 5;

  if (query.barcode) {
    const variant = await db.productVariant.findFirst({
      where: { businessId, barcode: query.barcode },
      include: { product: true, inventory: true },
    });
    if (variant) {
      const candidate = toCandidate(variant, 1, 'BARCODE');
      return { best: candidate, candidates: [candidate], method: 'BARCODE', score: 1 };
    }
  }

  if (query.sku) {
    const variant = await db.productVariant.findFirst({
      where: { businessId, sku: query.sku },
      include: { product: true, inventory: true },
    });
    if (variant) {
      const candidate = toCandidate(variant, 0.99, 'SKU');
      return { best: candidate, candidates: [candidate], method: 'SKU', score: 0.99 };
    }
  }

  const name = query.name?.trim();
  if (!name) return { best: null, candidates: [], method: 'NONE', score: 0 };

  const normalized = normalizeName(name);
  const variants = await db.productVariant.findMany({
    where: { businessId, isActive: true, product: { isActive: true } },
    include: { product: { include: { brand: true } }, inventory: true },
    take: 2000,
  });

  const queryTokens = normalized.split(' ').filter(Boolean);
  const querySize = query.size ?? extractSizeToken(name);

  const scored = variants
    .map((variant) => {
      const fullName = variant.isDefault
        ? variant.product.name
        : `${variant.product.name} ${variant.name}`;
      let score = similarity(name, fullName);
      let method: MatchMethod = 'FUZZY';

      if (normalizeName(fullName) === normalized) {
        score = 1;
        method = 'EXACT_NAME';
      } else if (
        normalizeName(variant.product.name) === normalized ||
        variant.product.normalizedName === normalized
      ) {
        score = 0.97;
        method = 'NORMALIZED_NAME';
      } else {
        // Brand and pack size are strong disambiguators between near-identical
        // catalogue entries ("Surf Excel 1kg" vs "Surf Excel 2kg").
        const brandName = variant.product.brand?.name;
        if (query.brand && brandName && similarity(query.brand, brandName) > 0.8) {
          score = Math.min(1, score + 0.08);
        }
        const candidateSize = extractSizeToken(fullName);
        if (querySize && candidateSize) {
          score = querySize === candidateSize ? Math.min(1, score + 0.12) : Math.max(0, score - 0.25);
        }
        if (queryTokens.length === 1 && normalizeName(fullName).startsWith(normalized)) {
          score = Math.min(1, score + 0.05);
        }
      }

      return { candidate: toCandidate(variant, Number(score.toFixed(4)), method), score };
    })
    .filter((row) => row.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const best = scored[0];
  if (!best || best.score < FUZZY_MATCH_FLOOR) {
    return {
      best: null,
      candidates: scored.map((s) => s.candidate),
      method: 'NONE',
      score: best?.score ?? 0,
    };
  }

  return {
    best: best.candidate,
    candidates: scored.map((s) => s.candidate),
    method: best.candidate.method,
    score: best.score,
  };
}

type VariantWithProduct = {
  id: string;
  productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  isDefault: boolean;
  purchasePricePaise: number;
  sellingPricePaise: number;
  mrpPaise: number;
  product: { name: string };
  inventory: { quantity: number } | null;
};

function toCandidate(variant: VariantWithProduct, score: number, method: MatchMethod): MatchCandidate {
  return {
    variantId: variant.id,
    productId: variant.productId,
    name: variant.isDefault ? variant.product.name : `${variant.product.name} - ${variant.name}`,
    sku: variant.sku,
    barcode: variant.barcode,
    score,
    method,
    purchasePricePaise: variant.purchasePricePaise,
    sellingPricePaise: variant.sellingPricePaise,
    mrpPaise: variant.mrpPaise,
    currentStock: variant.inventory?.quantity ?? 0,
  };
}
