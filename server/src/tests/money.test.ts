import { describe, expect, it } from 'vitest';
import {
  allocateProportionally,
  computeLineTax,
  nextAverageCost,
  roundOffToRupee,
  toPaise,
} from '../domain/money.js';
import { normalizeName, similarity, extractSizeToken } from '../utils/text.js';
import { parseExpiry, validateExtractedItem } from '../services/scanner/validation.js';

describe('tax calculation', () => {
  it('splits an MRP style inclusive price into base and tax', () => {
    const result = computeLineTax({ unitPricePaise: toPaise(105), quantity: 1, taxRate: 5, mode: 'INCLUSIVE' });
    expect(result.totalPaise).toBe(toPaise(105));
    expect(result.taxablePaise).toBe(10000);
    expect(result.taxPaise).toBe(500);
  });

  it('adds tax on top for exclusive pricing', () => {
    const result = computeLineTax({ unitPricePaise: toPaise(100), quantity: 2, taxRate: 18, mode: 'EXCLUSIVE' });
    expect(result.taxablePaise).toBe(toPaise(200));
    expect(result.taxPaise).toBe(toPaise(36));
    expect(result.totalPaise).toBe(toPaise(236));
  });

  it('applies the line discount before tax', () => {
    const result = computeLineTax({
      unitPricePaise: toPaise(100),
      quantity: 1,
      discountPaise: toPaise(10),
      taxRate: 10,
      mode: 'EXCLUSIVE',
    });
    expect(result.taxablePaise).toBe(toPaise(90));
    expect(result.taxPaise).toBe(toPaise(9));
    expect(result.totalPaise).toBe(toPaise(99));
  });

  it('charges nothing when tax is switched off', () => {
    const result = computeLineTax({ unitPricePaise: toPaise(50), quantity: 3, taxRate: 0, mode: 'INCLUSIVE' });
    expect(result.taxPaise).toBe(0);
    expect(result.totalPaise).toBe(toPaise(150));
  });
});

describe('bill maths', () => {
  it('rounds the bill to the nearest rupee and reports the adjustment', () => {
    expect(roundOffToRupee(49440)).toEqual({ total: 49400, roundOff: -40 });
    expect(roundOffToRupee(49460)).toEqual({ total: 49500, roundOff: 40 });
  });

  it('spreads a bill discount across lines without losing a paisa', () => {
    const allocation = allocateProportionally(1000, [3000, 2000, 1000]);
    expect(allocation.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(allocation[0]).toBeGreaterThan(allocation[2]);
  });

  it('moves the average cost towards the new purchase price', () => {
    expect(nextAverageCost(10, 10000, 10, 20000)).toBe(15000);
    expect(nextAverageCost(0, 0, 5, 12345)).toBe(12345);
    expect(nextAverageCost(10, 10000, 0, 99999)).toBe(10000);
  });
});

describe('product name matching', () => {
  it('normalises units and punctuation the same way everywhere', () => {
    expect(normalizeName('Surf Excel Matic 2 Kg')).toBe('surf excel matic 2kg');
    expect(normalizeName('RICE-5KG')).toBe('rice 5kg');
  });

  it('scores an invoice short name against the catalogue name', () => {
    const score = similarity('Surf Excel Matic 2KG', 'Surf Excel Matic Front Load 2 Kg');
    expect(score).toBeGreaterThan(0.6);
  });

  it('keeps unrelated products apart', () => {
    expect(similarity('Rice 5KG', 'Hair Serum 50ML')).toBeLessThan(0.3);
  });

  it('pulls the pack size out of a name', () => {
    expect(extractSizeToken('Sunflower Oil 1L')).toBe('1l');
    expect(extractSizeToken('Notebook')).toBeNull();
  });
});

describe('scanner validation', () => {
  const context = { allowedTaxRates: [0, 5, 12, 18], maxQuantity: 1000, maxPricePaise: 100000000, scanType: 'INVOICE' };

  it('blocks a zero or negative quantity', () => {
    const result = validateExtractedItem({ productName: 'Rice 5KG', quantity: 0, purchasePrice: 300 }, context);
    expect(result.issues.some((issue) => issue.field === 'quantity' && issue.severity === 'BLOCK')).toBe(true);
  });

  it('blocks a negative price', () => {
    const result = validateExtractedItem({ productName: 'Rice 5KG', quantity: 2, purchasePrice: -5 }, context);
    expect(result.issues.some((issue) => issue.field === 'purchasePrice' && issue.severity === 'BLOCK')).toBe(true);
  });

  it('asks about a tax rate the shop does not use', () => {
    const result = validateExtractedItem({ productName: 'Rice', quantity: 1, taxRate: 7 }, context);
    expect(result.issues.some((issue) => issue.field === 'taxRate' && issue.severity === 'ASK')).toBe(true);
  });

  it('asks when the purchase price is above MRP', () => {
    const result = validateExtractedItem({ productName: 'Rice', quantity: 1, purchasePrice: 400, mrp: 320 }, context);
    expect(result.issues.some((issue) => issue.field === 'purchasePrice')).toBe(true);
  });

  it('converts prices to paise and keeps quantities to three decimals', () => {
    const result = validateExtractedItem({ productName: 'Loose Dal', quantity: 1.23456, purchasePrice: 140.5 }, context);
    expect(result.purchasePricePaise).toBe(14050);
    expect(result.quantity).toBe(1.235);
  });

  it('reads the expiry formats printed on Indian packs', () => {
    expect(parseExpiry('2027-08-31')?.getFullYear()).toBe(2027);
    expect(parseExpiry('08/2027')?.getMonth()).toBe(7);
    expect(parseExpiry('31/08/2027')?.getDate()).toBe(31);
    expect(parseExpiry('Aug 2027')?.getMonth()).toBe(7);
    expect(parseExpiry('not a date')).toBeNull();
  });

  it('drops a barcode that could not be read properly', () => {
    const result = validateExtractedItem({ productName: 'Atta', quantity: 1, barcode: '12x' }, context);
    expect(result.barcode).toBeNull();
    expect(result.issues.some((issue) => issue.field === 'barcode')).toBe(true);
  });
});
