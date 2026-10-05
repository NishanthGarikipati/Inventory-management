export type UserRole = 'OWNER' | 'MANAGER' | 'CASHIER';

export type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'CREDIT' | 'OTHER';

export type ScanType = 'INVOICE' | 'PRODUCT' | 'SHELF' | 'STOCK_SHEET' | 'RECEIPT';

export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'EXPIRING_SOON';

export interface ErrorAction {
  label: string;
  action: string;
  payload?: Record<string, unknown>;
}

export interface Business {
  id: string;
  name: string;
  businessType: string;
  ownerName: string;
  phone: string;
  address: string | null;
  gstin: string | null;
  currency: string;
  country: string;
  logoRef: string | null;
}

export interface BusinessSettings {
  taxEnabled: boolean;
  pricesIncludeTax: boolean;
  defaultTaxRate: number;
  taxLabel: string;
  allowNegativeStock: boolean;
  roundOffSaleTotal: boolean;
  lowStockAlerts: boolean;
  expiryAlertDays: number;
  confidenceHigh: number;
  confidenceMedium: number;
  invoicePrefix: string;
}

export interface SessionUser {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
}

export interface BusinessTypeOption {
  code: string;
  name: string;
  description: string;
  icon: string;
  attributes: Array<{ key: string; label: string; dataType: string; options?: string[] }>;
}

export interface CatalogueVariant {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  isDefault: boolean;
  sellingPricePaise: number;
  purchasePricePaise: number;
  mrpPaise: number;
  minStock: number;
}

export interface CatalogueProduct {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  allowDecimal: boolean;
  taxRate: number;
  trackBatch: boolean;
  trackSerial: boolean;
  isComposite: boolean;
  isActive: boolean;
  variants: CatalogueVariant[];
}

/** One sellable row: a variant flattened with its product and stock. */
export interface SellableItem {
  variantId: string;
  productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit: string;
  allowDecimal: boolean;
  taxRate: number;
  sellingPricePaise: number;
  mrpPaise: number;
  stock: number;
  trackBatch: boolean;
  trackSerial: boolean;
}

export interface Party {
  id: string;
  name: string;
  phone: string | null;
  email?: string | null;
  address?: string | null;
  gstin?: string | null;
  balancePaise: number;
  creditLimitPaise: number;
}

export interface CartLine {
  variantId: string;
  name: string;
  unit: string;
  allowDecimal: boolean;
  quantity: number;
  unitPricePaise: number;
  mrpPaise: number;
  discountPaise: number;
  taxRate: number;
  stock: number;
  serials?: string[];
}

export interface DashboardData {
  greeting: string;
  business: { id: string; name: string; type: string; currency: string } | null;
  today: {
    salesPaise: number;
    billCount: number;
    purchasesPaise: number;
    expensesPaise: number;
    grossProfitPaise: number;
    creditGivenPaise: number;
  };
  alerts: {
    lowStock: number;
    outOfStock: number;
    expiringSoon: number;
    customerDuePaise: number;
    customerDueCount: number;
    supplierDuePaise: number;
    supplierDueCount: number;
    scansAwaitingReview: number;
  };
  stockValuePaise: number;
  topProducts: Array<{ variantId: string; name: string; quantity: number; revenuePaise: number; profitPaise: number }>;
  features: Record<string, boolean>;
  highlights: string[];
}

export interface InventoryRow {
  variantId: string;
  productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit: string;
  allowDecimal: boolean;
  category: string | null;
  brand: string | null;
  quantity: number;
  minStock: number;
  status: StockStatus;
  trackBatch: boolean;
  trackSerial: boolean;
  nearestExpiry: string | null;
  purchasePricePaise: number;
  sellingPricePaise: number;
  mrpPaise: number;
  stockValuePaise: number;
  avgCostPaise: number;
}

export interface ScanItem {
  id: string;
  lineNumber: number;
  extractedProductName: string;
  barcode: string | null;
  matchedVariantId: string | null;
  matchedProductName: string | null;
  matchMethod: string;
  matchScore: number;
  matchBand: 'HIGH' | 'MEDIUM' | 'LOW';
  matchCandidates: Array<{ variantId: string; name: string; score: number; method: string }>;
  quantity: number | null;
  unitHint: string | null;
  purchasePricePaise: number | null;
  sellingPricePaise: number | null;
  mrpPaise: number | null;
  taxRate: number | null;
  batch: string | null;
  expiry: string | null;
  confidence: number;
  confidenceBand: 'HIGH' | 'MEDIUM' | 'LOW';
  fieldConfidence: Record<string, unknown>;
  issues: Array<{ field: string; message: string; severity: 'BLOCK' | 'ASK' }>;
  reviewState: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'NEEDS_INPUT';
  userCorrected: boolean;
  createNewProduct: boolean;
  currentStock: number | null;
  suggestedForApproval: boolean;
}

export interface ScanDetail {
  id: string;
  scanType: ScanType;
  status: 'UPLOADED' | 'PROCESSING' | 'EXTRACTED' | 'REVIEW_REQUIRED' | 'APPROVED' | 'REJECTED' | 'FAILED';
  provider: string | null;
  extractedSupplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  overallConfidence: number;
  failureReason: string | null;
  createdAt: string;
  resultRefType: string | null;
  resultRefId: string | null;
  supplierId: string | null;
  items: ScanItem[];
  thresholds: { high: number; medium: number };
  approvals: Array<{ id: string; approvedAt: string; approvedItems: number; rejectedItems: number; approvedBy: { name: string } | null }>;
  corrections: Array<{ field: string; originalValue: string | null; correctedValue: string | null }>;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  isRead: boolean;
  createdAt: string;
  refType: string | null;
  refId: string | null;
}
