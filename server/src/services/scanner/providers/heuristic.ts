import type { ExtractionProvider, ExtractionRequest, ExtractionResult, ExtractedItem } from '../types.js';

/**
 * Deterministic text extraction. It reads the OCR text produced on the device
 * (Android text recognition) or by a server OCR engine, and turns invoice,
 * label and stock-sheet layouts into structured items.
 *
 * It exists for three reasons: it is the offline/no-API-key fallback, it is
 * fully unit testable, and it gives the vision provider a baseline to be
 * compared against.
 */
export class HeuristicProvider implements ExtractionProvider {
  readonly name = 'heuristic';

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const text = (request.ocrText ?? '').trim();
    if (!text) {
      return {
        provider: this.name,
        items: [],
        overallConfidence: 0,
        notes: [
          'No readable text was found in this photo.',
        ],
      };
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    switch (request.scanType) {
      case 'PRODUCT':
        return this.extractProductLabel(lines, request);
      case 'STOCK_SHEET':
        return this.extractStockSheet(lines);
      case 'SHELF':
        return {
          provider: this.name,
          items: [],
          overallConfidence: 0,
          notes: ['Shelf photos need the vision model. Please scan barcodes or enter the count by hand.'],
        };
      default:
        return this.extractInvoice(lines, request);
    }
  }

  private extractInvoice(lines: string[], request: ExtractionRequest): ExtractionResult {
    const supplier = findSupplier(lines);
    const invoiceNumber = findInvoiceNumber(lines);
    const invoiceDate = findInvoiceDate(lines);
    const items: ExtractedItem[] = [];

    for (const line of lines) {
      if (isNoiseLine(line)) continue;
      const parsed = parseInvoiceLine(line);
      if (parsed) items.push(parsed);
    }

    const barcodeHints = request.barcodes ?? [];
    if (barcodeHints.length === 1 && items.length === 1 && !items[0].barcode) {
      items[0].barcode = barcodeHints[0];
      items[0].fieldConfidence = { ...items[0].fieldConfidence, barcode: 1 };
    }

    const overall = items.length
      ? Number((items.reduce((sum, i) => sum + i.confidence, 0) / items.length).toFixed(4))
      : 0;

    return {
      provider: this.name,
      supplier,
      invoiceNumber,
      invoiceDate,
      items,
      overallConfidence: overall,
      multipleDocuments: countInvoiceHeaders(lines) > 1,
      notes: items.length ? [] : ['No product lines were found on this invoice.'],
      rawPayload: { lineCount: lines.length },
    };
  }

  private extractProductLabel(lines: string[], request: ExtractionRequest): ExtractionResult {
    const mrpLine = lines.find((line) => /mrp|m\.r\.p/i.test(line));
    const mrp = mrpLine ? parseAmount(mrpLine) : null;
    const barcode = request.barcodes?.[0] ?? findBarcode(lines);
    const sizeLine = lines.find((line) => /\b\d+(?:\.\d+)?\s*(kg|g|gm|ml|l|ltr|litre)\b/i.test(line));
    const nameLine =
      lines
        .filter((line) => !/mrp|batch|exp|mfg|barcode|net wt|\d{8,}/i.test(line))
        .sort((a, b) => letterCount(b) - letterCount(a))[0] ?? lines[0];

    const size = sizeLine?.match(/\b(\d+(?:\.\d+)?\s*(?:kg|g|gm|ml|l|ltr|litre))\b/i)?.[1];
    // The brand is usually the first, shortest line on the pack.
    const brandLine = lines[0] && lines[0] !== nameLine && letterCount(lines[0]) <= 15 ? lines[0] : null;
    const productName = [
      brandLine,
      nameLine,
      size && !new RegExp(size, 'i').test(nameLine) ? size : null,
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const fieldConfidence: Record<string, number> = {
      product_name: nameLine ? 0.9 : 0.3,
      mrp: mrp ? 0.93 : 0,
      barcode: barcode ? 1 : 0,
    };
    const confidence = average(Object.values(fieldConfidence).filter((v) => v > 0));

    return {
      provider: this.name,
      items: [
        {
          productName,
          mrp,
          sellingPrice: mrp,
          barcode: barcode ?? null,
          batch: findLabelled(lines, /batch\s*(?:no\.?)?\s*[:\-]?\s*([A-Za-z0-9\-\/]+)/i),
          expiry: findLabelled(lines, /(?:exp|expiry|use before)\s*[:\-]?\s*([A-Za-z0-9\-\/\s]+)/i),
          confidence,
          fieldConfidence,
          raw: lines.join(' | '),
        },
      ],
      overallConfidence: confidence,
      notes: [],
    };
  }

  private extractStockSheet(lines: string[]): ExtractionResult {
    const items: ExtractedItem[] = [];
    for (const line of lines) {
      if (isNoiseLine(line)) continue;
      const match = line.match(/^(.+?)[\s\-–:]+(\d+(?:\.\d+)?)\s*(kg|g|l|ml|pcs?|nos?|box|pack)?$/i);
      if (!match) continue;
      const name = match[1].replace(/[-–:]+$/, '').trim();
      if (!name || /total|date|page/i.test(name)) continue;
      // Handwriting is read less reliably than print; say so in the score.
      const confidence = 0.78;
      items.push({
        productName: name,
        quantity: Number(match[2]),
        unit: match[3]?.toUpperCase() ?? null,
        confidence,
        fieldConfidence: { product_name: 0.8, quantity: 0.76 },
        raw: line,
      });
    }

    return {
      provider: this.name,
      items,
      overallConfidence: items.length ? average(items.map((i) => i.confidence)) : 0,
      notes: ['Handwriting is read with lower accuracy. Please check every quantity.'],
    };
  }
}

const NOISE_PATTERNS = [
  /^(sub\s*total|total|grand total|amount|tax|gst|cgst|sgst|igst|discount|round|balance|paid|signature|thank)/i,
  /^(s\.?\s*no|sr|item|description|qty|rate|particulars)\b/i,
  /^-+$/,
  /^page\s*\d+/i,
];

const isNoiseLine = (line: string): boolean => NOISE_PATTERNS.some((pattern) => pattern.test(line.trim()));

const UNIT_WORDS = /^(kgs?|gms?|g|ltrs?|l|ml|pcs?|nos?|box|pack|strip|dozen|pair|plate)$/i;
const PURE_NUMBER = /^(?:\d{1,3}(?:,\d{2,3})*|\d+)(?:\.\d+)?$/;

/**
 * Invoice lines end with numbers (qty, rate, amount) while the product name
 * keeps its pack size. "RICE 5KG 20 300 6000" must read as 20 units of
 * "Rice 5KG" at 300 - not 5 units of "Rice" - so only standalone numeric
 * tokens at the end of the line are treated as figures.
 */
function parseInvoiceLine(line: string): ExtractedItem | null {
  const cleaned = line.replace(/[₹|]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = cleaned.split(' ');

  const numbers: number[] = [];
  let unit: string | null = null;
  let cut = tokens.length;

  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (UNIT_WORDS.test(token) && numbers.length > 0) {
      unit = token.toUpperCase();
      cut = index;
      continue;
    }
    if (!PURE_NUMBER.test(token)) break;
    const value = toNumber(token);
    if (value === null) break;
    numbers.unshift(value);
    cut = index;
  }

  const name = tokens.slice(0, cut).join(' ').replace(/^\d+[.)]\s*/, '').replace(/[-:|]+$/, '').trim();
  if (!name || letterCount(name) < 2 || numbers.length === 0) return null;

  let quantity: number;
  let rate: number | null = null;
  let amount: number | null = null;
  let rateConfidence = 0.9;

  if (numbers.length >= 3) {
    // qty, rate, amount (possibly with tax or discount columns between).
    quantity = numbers[0];
    amount = numbers[numbers.length - 1];
    const exact = numbers.slice(1).find((value) => Math.abs(value * quantity - amount!) <= Math.max(1, amount! * 0.01));
    rate = exact ?? numbers[1];
    rateConfidence = exact !== undefined ? 0.97 : 0.8;
  } else if (numbers.length === 2) {
    quantity = numbers[0];
    rate = numbers[1];
    // "12 1440" is usually qty and line amount, not qty and rate.
    if (Number.isInteger(quantity) && rate / quantity > 1 && Math.abs((rate / quantity) % 1) < 0.001 && rate > quantity * 50) {
      rateConfidence = 0.75;
    }
  } else {
    quantity = numbers[0];
    rateConfidence = 0;
  }

  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const fieldConfidence: Record<string, number> = {
    product_name: letterCount(name) > 3 ? 0.95 : 0.7,
    quantity: Number.isInteger(quantity) ? 0.96 : 0.9,
  };
  if (rate !== null) fieldConfidence.purchase_price = rateConfidence;

  return {
    productName: name,
    quantity,
    unit,
    purchasePrice: rate,
    confidence: Number(average(Object.values(fieldConfidence)).toFixed(4)),
    fieldConfidence,
    raw: line,
  };
}

function findSupplier(lines: string[]): string | null {
  const labelled = findLabelled(lines, /^(?:supplier|from|sold by|m\/s)\s*[:\-]?\s*(.+)$/i);
  if (labelled) return labelled.trim();
  const header = lines
    .slice(0, 4)
    .find((line) => letterCount(line) > 4 && !/invoice|bill|gst|tax|date|phone|mobile/i.test(line));
  return header?.trim() ?? null;
}

function findInvoiceNumber(lines: string[]): string | null {
  return findLabelled(lines, /(?:invoice|bill|inv)\s*(?:no\.?|number|#)?\s*[:\-#]\s*([A-Za-z0-9\-\/]+)/i);
}

function findInvoiceDate(lines: string[]): string | null {
  for (const line of lines) {
    const iso = line.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso) return iso[1];
    const dmy = line.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
    if (dmy) {
      const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
      return `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    }
  }
  return null;
}

function findBarcode(lines: string[]): string | null {
  for (const line of lines) {
    const match = line.match(/\b(\d{8,14})\b/);
    if (match) return match[1];
  }
  return null;
}

function findLabelled(lines: string[], pattern: RegExp): string | null {
  for (const line of lines) {
    const match = line.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

const countInvoiceHeaders = (lines: string[]): number =>
  lines.filter((line) => /^(tax\s+)?invoice\b/i.test(line.trim())).length;

function parseAmount(line: string): number | null {
  const match = line.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function toNumber(token: string): number | null {
  const value = Number(token.replace(/,/g, '').replace(/[^\d.]/g, ''));
  return Number.isFinite(value) ? value : null;
}

const letterCount = (text: string): number => (text.match(/[A-Za-z]/g) ?? []).length;

const average = (values: number[]): number =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
