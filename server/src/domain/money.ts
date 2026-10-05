/**
 * All money is integer paise. All quantities are floats rounded to 3 decimals.
 * Keeping this in one place means tax/discount/profit maths is consistent
 * across sales, purchases, returns and reports.
 */

export const toPaise = (rupees: number): number => Math.round(rupees * 100);
export const toRupees = (paise: number): number => Math.round(paise) / 100;
export const paise = (value: number): number => Math.round(value);

export const roundQty = (qty: number): number => Math.round(qty * 1000) / 1000;

/** Nearest rupee round-off, as printed on Indian retail bills. */
export const roundOffToRupee = (amountPaise: number): { total: number; roundOff: number } => {
  const total = Math.round(amountPaise / 100) * 100;
  return { total, roundOff: total - amountPaise };
};

export type TaxMode = 'INCLUSIVE' | 'EXCLUSIVE';

export interface LineTaxInput {
  /** Unit price as entered by the user (inclusive or exclusive per mode). */
  unitPricePaise: number;
  quantity: number;
  /** Line level discount in paise (applied to the full line). */
  discountPaise?: number;
  taxRate: number;
  mode: TaxMode;
}

export interface LineTaxResult {
  /** Price base before tax, after discount. */
  taxablePaise: number;
  taxPaise: number;
  /** What the customer pays for the line. */
  totalPaise: number;
  /** Gross line value before discount, tax inclusive. */
  grossPaise: number;
  discountPaise: number;
}

/**
 * Computes a single line's tax split. Tax-inclusive pricing is the norm for
 * Indian MRP-driven retail, tax-exclusive is used by many distributors, so both
 * are first class and configurable (never hard-coded).
 */
export function computeLineTax(input: LineTaxInput): LineTaxResult {
  const rate = Math.max(0, input.taxRate ?? 0);
  const discountPaise = Math.max(0, Math.round(input.discountPaise ?? 0));
  const grossPaise = Math.round(input.unitPricePaise * input.quantity);
  const netPaise = Math.max(0, grossPaise - discountPaise);

  if (rate === 0) {
    return { taxablePaise: netPaise, taxPaise: 0, totalPaise: netPaise, grossPaise, discountPaise };
  }

  if (input.mode === 'INCLUSIVE') {
    const taxablePaise = Math.round(netPaise / (1 + rate / 100));
    const taxPaise = netPaise - taxablePaise;
    return { taxablePaise, taxPaise, totalPaise: netPaise, grossPaise, discountPaise };
  }

  const taxPaise = Math.round((netPaise * rate) / 100);
  return {
    taxablePaise: netPaise,
    taxPaise,
    totalPaise: netPaise + taxPaise,
    grossPaise,
    discountPaise,
  };
}

/**
 * Moving average cost. Returning a fresh value keeps the inventory service
 * free of in-place mutation bugs when several lines touch the same product.
 */
export function nextAverageCost(
  currentQty: number,
  currentAvgPaise: number,
  incomingQty: number,
  incomingCostPaise: number,
): number {
  if (incomingQty <= 0) return currentAvgPaise;
  const baseQty = Math.max(0, currentQty);
  const totalQty = baseQty + incomingQty;
  if (totalQty <= 0) return incomingCostPaise;
  const totalValue = baseQty * currentAvgPaise + incomingQty * incomingCostPaise;
  return Math.round(totalValue / totalQty);
}

/** Distributes an invoice-level discount across lines, proportional to value. */
export function allocateProportionally(totalToAllocate: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || totalToAllocate <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => Math.floor((totalToAllocate * w) / sum));
  let remainder = totalToAllocate - raw.reduce((a, b) => a + b, 0);
  // Hand the rounding remainder to the largest lines first.
  const order = weights
    .map((w, i) => ({ w, i }))
    .sort((a, b) => b.w - a.w)
    .map((x) => x.i);
  for (const idx of order) {
    if (remainder <= 0) break;
    raw[idx] += 1;
    remainder -= 1;
  }
  return raw;
}
