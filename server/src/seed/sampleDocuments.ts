import type { ScanType } from '../domain/enums.js';

/**
 * Sample documents for the smart scanner. Each one is rendered to a real PNG
 * (see textImage.ts) and its text doubles as the on-device OCR result, so the
 * whole upload -> read -> match -> review -> confirm path can be demonstrated
 * and tested without an AI key.
 */
export interface SampleDocument {
  key: string;
  title: string;
  scanType: ScanType;
  lines: string[];
  barcodes?: string[];
}

export const SAMPLE_DOCUMENTS: SampleDocument[] = [
  {
    key: 'invoice-abc-distributors',
    title: 'Supplier invoice - ABC Distributors',
    scanType: 'INVOICE',
    lines: [
      'ABC DISTRIBUTORS',
      'SHOP 14, MARKET ROAD, PUNE',
      'GSTIN: 27AABCU9603R1ZM',
      'TAX INVOICE',
      'INVOICE NO: INV-12345',
      'DATE: 16/09/2026',
      '',
      'ITEM              QTY   RATE   AMOUNT',
      '-----------------------------------',
      'RICE 5KG          20    300    6000',
      'SUGAR 1KG         30    45     1350',
      'SUNFLOWER OIL 1L  15    110    1650',
      'TOOR DAL 1KG      10    140    1400',
      '-----------------------------------',
      'SUB TOTAL                    10400',
      'GST 5%                         520',
      'TOTAL                        10920',
    ],
  },
  {
    key: 'invoice-sharma-traders',
    title: 'Supplier invoice - Sharma Traders (new products)',
    scanType: 'INVOICE',
    lines: [
      'SHARMA TRADERS',
      'INVOICE NO: ST-9981',
      'DATE: 18/09/2026',
      '',
      'ITEM                  QTY  RATE  AMOUNT',
      'SURF EXCEL MATIC 2KG  12   420   5040',
      'COLGATE STRONG 200G   24   85    2040',
      'PARLE G BISCUIT 250G  48   25    1200',
      'TOTAL                       8280',
    ],
  },
  {
    key: 'product-label-atta',
    title: 'Product label - Aashirvaad Atta 5KG',
    scanType: 'PRODUCT',
    lines: [
      'AASHIRVAAD',
      'SHUDH CHAKKI ATTA',
      'NET WT 5 KG',
      'MRP: 320.00',
      'BATCH: AT2291',
      'EXP: 08/2027',
      '8901030865278',
    ],
    barcodes: ['8901030865278'],
  },
  {
    key: 'stock-sheet-handwritten',
    title: 'Handwritten stock sheet',
    scanType: 'STOCK_SHEET',
    lines: [
      'STOCK COUNT 20/09/2026',
      '',
      'RICE 5KG - 20',
      'SUGAR 1KG - 15',
      'SUNFLOWER OIL 1L - 10',
      'TOOR DAL 1KG - 8',
    ],
  },
  {
    key: 'shelf-photo',
    title: 'Shelf photo (needs vision model)',
    scanType: 'SHELF',
    lines: [
      'RICE 5KG   RICE 5KG   SUGAR 1KG',
      'OIL 1L     OIL 1L     SUGAR 1KG',
    ],
  },
  {
    key: 'invoice-pharma',
    title: 'Pharmacy invoice with batches',
    scanType: 'INVOICE',
    lines: [
      'MEDILINE PHARMA DISTRIBUTORS',
      'INVOICE NO: MD-4410',
      'DATE: 15/09/2026',
      '',
      'ITEM                 QTY  RATE  AMOUNT',
      'PARACETAMOL 500MG    50   12    600',
      'AMOXICILLIN 250MG    30   48    1440',
      'COUGH SYRUP 100ML    20   85    1700',
      'TOTAL                      3740',
    ],
  },
];

export const sampleByKey = (key: string): SampleDocument | undefined =>
  SAMPLE_DOCUMENTS.find((doc) => doc.key === key);
