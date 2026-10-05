import { z } from 'zod';

/**
 * Schema for raw model output. Anything a provider returns is parsed through
 * this before it is looked at again - an AI response is untrusted input.
 */
export const extractionItemSchema = z.object({
  product_name: z.string().min(1).max(200),
  quantity: z.number().finite().nullable().optional(),
  unit: z.string().max(20).nullable().optional(),
  purchase_price: z.number().finite().nullable().optional(),
  selling_price: z.number().finite().nullable().optional(),
  mrp: z.number().finite().nullable().optional(),
  barcode: z.string().max(40).nullable().optional(),
  batch: z.string().max(40).nullable().optional(),
  expiry: z.string().max(20).nullable().optional(),
  tax_rate: z.number().min(0).max(100).nullable().optional(),
  confidence: z.number().min(0).max(1),
  field_confidence: z.record(z.number().min(0).max(1)).optional(),
  raw: z.string().max(500).nullable().optional(),
});

export const extractionSchema = z.object({
  supplier: z.string().max(200).nullable().optional(),
  invoice_number: z.string().max(60).nullable().optional(),
  invoice_date: z.string().max(20).nullable().optional(),
  multiple_documents: z.boolean().optional(),
  notes: z.array(z.string().max(300)).optional(),
  items: z.array(extractionItemSchema).max(300),
});

export interface BusinessRuleContext {
  allowedTaxRates: number[];
  maxQuantity: number;
  maxPricePaise: number;
  scanType: string;
}

export interface ValidationIssue {
  field: string;
  message: string;
  severity: 'BLOCK' | 'ASK';
}

export interface ValidatedItem {
  productName: string;
  quantity: number | null;
  unit: string | null;
  purchasePricePaise: number | null;
  sellingPricePaise: number | null;
  mrpPaise: number | null;
  barcode: string | null;
  batch: string | null;
  expiry: Date | null;
  taxRate: number | null;
  issues: ValidationIssue[];
}

/**
 * Deterministic business-rule validation applied to every extracted line,
 * before matching and before it can ever reach the review screen as
 * "ready to confirm". Nothing here depends on the model's own opinion.
 */
export function validateExtractedItem(
  item: {
    productName: string;
    quantity?: number | null;
    unit?: string | null;
    purchasePrice?: number | null;
    sellingPrice?: number | null;
    mrp?: number | null;
    barcode?: string | null;
    batch?: string | null;
    expiry?: string | null;
    taxRate?: number | null;
  },
  context: BusinessRuleContext,
): ValidatedItem {
  const issues: ValidationIssue[] = [];

  const productName = item.productName.trim().slice(0, 200);
  if (productName.length < 2) {
    issues.push({ field: 'productName', message: 'We could not read the product name clearly.', severity: 'BLOCK' });
  }

  let quantity = item.quantity ?? null;
  if (quantity !== null) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      issues.push({ field: 'quantity', message: 'Quantity must be more than zero.', severity: 'BLOCK' });
      quantity = null;
    } else if (quantity > context.maxQuantity) {
      issues.push({
        field: 'quantity',
        message: `Quantity ${quantity} looks too large. Please check it.`,
        severity: 'ASK',
      });
    } else {
      quantity = Math.round(quantity * 1000) / 1000;
    }
  } else if (context.scanType !== 'PRODUCT') {
    issues.push({ field: 'quantity', message: 'We could not read the quantity. Please enter it.', severity: 'BLOCK' });
  }

  const purchasePricePaise = toPaiseOrIssue(item.purchasePrice, 'purchasePrice', context, issues);
  const sellingPricePaise = toPaiseOrIssue(item.sellingPrice, 'sellingPrice', context, issues);
  const mrpPaise = toPaiseOrIssue(item.mrp, 'mrp', context, issues);

  if (purchasePricePaise !== null && mrpPaise !== null && purchasePricePaise > mrpPaise && mrpPaise > 0) {
    issues.push({
      field: 'purchasePrice',
      message: 'Purchase price is higher than MRP. Please check.',
      severity: 'ASK',
    });
  }

  let taxRate = item.taxRate ?? null;
  if (taxRate !== null) {
    if (taxRate < 0 || taxRate > 100) {
      issues.push({ field: 'taxRate', message: 'Tax rate looks wrong.', severity: 'BLOCK' });
      taxRate = null;
    } else if (context.allowedTaxRates.length && !context.allowedTaxRates.includes(taxRate)) {
      issues.push({
        field: 'taxRate',
        message: `${taxRate}% is not one of your tax rates. Please confirm.`,
        severity: 'ASK',
      });
    }
  }

  const barcode = item.barcode?.replace(/\D/g, '') || null;
  if (item.barcode && (!barcode || barcode.length < 8 || barcode.length > 14)) {
    issues.push({ field: 'barcode', message: 'The barcode could not be read properly.', severity: 'ASK' });
  }

  const expiry = parseExpiry(item.expiry ?? null);
  if (item.expiry && !expiry) {
    issues.push({ field: 'expiry', message: 'We could not read the expiry date. Please enter it.', severity: 'ASK' });
  }
  if (expiry && expiry.getTime() < Date.now() - 365 * 86400_000) {
    issues.push({ field: 'expiry', message: 'This expiry date is in the past. Please check.', severity: 'ASK' });
  }

  const batch = item.batch?.trim().slice(0, 40) || null;
  if (batch && !/^[A-Za-z0-9\-\/]+$/.test(batch)) {
    issues.push({ field: 'batch', message: 'The batch number could not be read properly.', severity: 'ASK' });
  }

  return {
    productName,
    quantity,
    unit: item.unit?.trim().toUpperCase().slice(0, 20) ?? null,
    purchasePricePaise,
    sellingPricePaise,
    mrpPaise,
    barcode: barcode && barcode.length >= 8 && barcode.length <= 14 ? barcode : null,
    batch,
    expiry,
    taxRate,
    issues,
  };
}

function toPaiseOrIssue(
  value: number | null | undefined,
  field: string,
  context: BusinessRuleContext,
  issues: ValidationIssue[],
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) {
    issues.push({ field, message: 'Price cannot be negative.', severity: 'BLOCK' });
    return null;
  }
  const paise = Math.round(value * 100);
  if (paise > context.maxPricePaise) {
    issues.push({ field, message: `₹${value} looks too high. Please check.`, severity: 'ASK' });
  }
  return paise;
}

/** Accepts YYYY-MM-DD, MM/YYYY, DD/MM/YYYY and "Jan 2027" style label dates. */
export function parseExpiry(raw: string | null): Date | null {
  if (!raw) return null;
  const text = raw.trim();

  const iso = text.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (iso) return endOfMonthOrDay(Number(iso[1]), Number(iso[2]), iso[3] ? Number(iso[3]) : null);

  const dmy = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    const year = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return endOfMonthOrDay(year, Number(dmy[2]), Number(dmy[1]));
  }

  const my = text.match(/^(\d{1,2})[\/\-.](\d{2,4})$/);
  if (my) {
    const year = my[2].length === 2 ? 2000 + Number(my[2]) : Number(my[2]);
    return endOfMonthOrDay(year, Number(my[1]), null);
  }

  const monthName = text.match(/^([A-Za-z]{3,9})\s*[\-\/ ]?\s*(\d{2,4})$/);
  if (monthName) {
    const month = MONTHS.findIndex((m) => m.startsWith(monthName[1].toLowerCase().slice(0, 3)));
    if (month >= 0) {
      const year = monthName[2].length === 2 ? 2000 + Number(monthName[2]) : Number(monthName[2]);
      return endOfMonthOrDay(year, month + 1, null);
    }
  }

  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function endOfMonthOrDay(year: number, month: number, day: number | null): Date | null {
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  // Medicine packs print MM/YYYY and expire at the end of that month.
  const date = day ? new Date(year, month - 1, day, 23, 59, 59) : new Date(year, month, 0, 23, 59, 59);
  return Number.isNaN(date.getTime()) ? null : date;
}
