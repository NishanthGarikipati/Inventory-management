import type { ScanType } from '../../domain/enums.js';

/** What a provider is asked to read. */
export interface ExtractionRequest {
  scanType: ScanType;
  imageBuffer: Buffer;
  mimeType: string;
  /**
   * Text read on the device (Android text recognition) or by a server OCR
   * engine. Providers may use it instead of, or alongside, the pixels.
   */
  ocrText?: string;
  /** Barcodes decoded by the phone camera - hard evidence, beats vision. */
  barcodes?: string[];
  businessType?: string;
  /** Catalogue names passed as context so the model prefers known products. */
  knownProductNames?: string[];
}

export interface ExtractedItem {
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
  confidence: number;
  fieldConfidence?: Record<string, number>;
  raw?: string;
}

export interface ExtractionResult {
  provider: string;
  supplier?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  items: ExtractedItem[];
  overallConfidence: number;
  /** Set when the provider believes the photo holds more than one document. */
  multipleDocuments?: boolean;
  notes?: string[];
  rawPayload?: unknown;
}

export interface ExtractionProvider {
  readonly name: string;
  extract(request: ExtractionRequest): Promise<ExtractionResult>;
}
