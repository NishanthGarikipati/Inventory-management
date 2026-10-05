export const INVENTORY_TRANSACTION_TYPES = [
  'OPENING',
  'PURCHASE',
  'SALE',
  'SALE_RETURN',
  'PURCHASE_RETURN',
  'ADJUSTMENT',
  'DAMAGE',
  'EXPIRY',
  'TRANSFER',
  'PRODUCTION',
  'CONSUMPTION',
  'IMAGE_SCAN_ADJUSTMENT',
] as const;
export type InventoryTransactionType = (typeof INVENTORY_TRANSACTION_TYPES)[number];

export const TRANSACTION_SOURCES = ['MANUAL', 'BARCODE', 'IMAGE_SCAN', 'SYSTEM', 'IMPORT', 'OFFLINE_SYNC'] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'CREDIT', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ADJUSTMENT_REASONS = [
  'DAMAGED',
  'EXPIRED',
  'LOST',
  'PERSONAL_USE',
  'COUNT_DIFF',
  'OPENING',
  'OTHER',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const SCAN_TYPES = ['INVOICE', 'PRODUCT', 'SHELF', 'STOCK_SHEET', 'RECEIPT'] as const;
export type ScanType = (typeof SCAN_TYPES)[number];

export const SCAN_STATUSES = [
  'UPLOADED',
  'PROCESSING',
  'EXTRACTED',
  'REVIEW_REQUIRED',
  'APPROVED',
  'REJECTED',
  'FAILED',
] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const MATCH_METHODS = ['BARCODE', 'SKU', 'EXACT_NAME', 'NORMALIZED_NAME', 'FUZZY', 'NONE'] as const;
export type MatchMethod = (typeof MATCH_METHODS)[number];

export const USER_ROLES = ['OWNER', 'MANAGER', 'CASHIER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const BUSINESS_TYPE_CODES = [
  'KIRANA',
  'GROCERY',
  'MEDICAL',
  'ELECTRONICS',
  'STATIONERY',
  'BAKERY',
  'BOUTIQUE',
  'HARDWARE',
  'RESTAURANT',
  'MOBILE_ACCESSORIES',
  'COSMETICS',
] as const;
export type BusinessTypeCode = (typeof BUSINESS_TYPE_CODES)[number];

/** Capabilities a business type can switch on. Settings can override each one. */
export const FEATURE_KEYS = [
  'BARCODE',
  'LOOSE_QUANTITY',
  'UNIT_CONVERSION',
  'MRP',
  'BATCH_TRACKING',
  'EXPIRY_TRACKING',
  'FEFO',
  'SERIAL_TRACKING',
  'IMEI',
  'WARRANTY',
  'VARIANTS',
  'RECIPES',
  'PRODUCTION',
  'WASTAGE',
  'TABLE_MANAGEMENT',
  'TAKEAWAY_DELIVERY',
  'PRESCRIPTION',
  'BULK_PRICING',
  'EXCHANGES',
  'COMPATIBILITY',
  'OFFERS',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity',
  'Salary',
  'Transport',
  'Packaging',
  'Marketing',
  'Maintenance',
  'Other',
] as const;
