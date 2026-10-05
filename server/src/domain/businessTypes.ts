import { FEATURE_KEYS, type BusinessTypeCode, type FeatureKey } from './enums.js';

export interface AttributeTemplate {
  key: string;
  label: string;
  dataType: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'BOOLEAN';
  options?: string[];
  isRequired?: boolean;
  showInList?: boolean;
  appliesToVariant?: boolean;
}

export interface UnitTemplate {
  code: string;
  name: string;
  allowDecimal: boolean;
}

export interface BusinessTypeTemplate {
  code: BusinessTypeCode;
  name: string;
  description: string;
  icon: string;
  sortOrder: number;
  features: FeatureKey[];
  attributes: AttributeTemplate[];
  units: UnitTemplate[];
  categories: string[];
  /** Extra dashboard cards this industry cares about. */
  dashboardHighlights: string[];
  defaultTaxRates: number[];
}

const UNIT = {
  PCS: { code: 'PCS', name: 'Piece', allowDecimal: false },
  BOX: { code: 'BOX', name: 'Box', allowDecimal: false },
  PACK: { code: 'PACK', name: 'Pack', allowDecimal: false },
  KG: { code: 'KG', name: 'Kilogram', allowDecimal: true },
  G: { code: 'G', name: 'Gram', allowDecimal: true },
  L: { code: 'L', name: 'Litre', allowDecimal: true },
  ML: { code: 'ML', name: 'Millilitre', allowDecimal: true },
  M: { code: 'M', name: 'Meter', allowDecimal: true },
  PAIR: { code: 'PAIR', name: 'Pair', allowDecimal: false },
  DOZEN: { code: 'DOZEN', name: 'Dozen', allowDecimal: false },
  PLATE: { code: 'PLATE', name: 'Plate', allowDecimal: false },
  STRIP: { code: 'STRIP', name: 'Strip', allowDecimal: false },
} satisfies Record<string, UnitTemplate>;

const BASE_UNITS: UnitTemplate[] = [UNIT.PCS, UNIT.BOX, UNIT.PACK];

const BATCH_ATTRS: AttributeTemplate[] = [
  { key: 'batch', label: 'Batch', dataType: 'TEXT' },
  { key: 'expiry', label: 'Expiry', dataType: 'DATE', showInList: true },
];

export const BUSINESS_TYPE_TEMPLATES: BusinessTypeTemplate[] = [
  {
    code: 'KIRANA',
    name: 'Kirana / General Store',
    description: 'Everyday household goods, loose and packed',
    icon: '🏪',
    sortOrder: 1,
    features: ['BARCODE', 'LOOSE_QUANTITY', 'UNIT_CONVERSION', 'MRP', 'BATCH_TRACKING', 'EXPIRY_TRACKING', 'OFFERS'],
    attributes: [
      { key: 'weight', label: 'Weight / Size', dataType: 'TEXT', showInList: true },
      ...BATCH_ATTRS,
    ],
    units: [...BASE_UNITS, UNIT.KG, UNIT.G, UNIT.L, UNIT.ML, UNIT.DOZEN],
    categories: ['Staples', 'Snacks', 'Beverages', 'Cleaning', 'Personal Care', 'Dairy'],
    dashboardHighlights: ['LOW_STOCK', 'CUSTOMER_DUE', 'EXPIRING'],
    defaultTaxRates: [0, 5, 12, 18],
  },
  {
    code: 'GROCERY',
    name: 'Grocery Store',
    description: 'Fresh and packaged groceries sold by weight',
    icon: '🥬',
    sortOrder: 2,
    features: ['BARCODE', 'LOOSE_QUANTITY', 'UNIT_CONVERSION', 'MRP', 'BATCH_TRACKING', 'EXPIRY_TRACKING'],
    attributes: [
      { key: 'weight', label: 'Weight', dataType: 'TEXT', showInList: true },
      { key: 'perishable', label: 'Perishable', dataType: 'BOOLEAN' },
      ...BATCH_ATTRS,
    ],
    units: [...BASE_UNITS, UNIT.KG, UNIT.G, UNIT.L, UNIT.ML],
    categories: ['Vegetables', 'Fruits', 'Dairy', 'Staples', 'Frozen', 'Bakery'],
    dashboardHighlights: ['EXPIRING', 'LOW_STOCK', 'WASTAGE'],
    defaultTaxRates: [0, 5, 12],
  },
  {
    code: 'MEDICAL',
    name: 'Medical Store / Pharmacy',
    description: 'Medicines with batch, expiry and composition tracking',
    icon: '💊',
    sortOrder: 3,
    features: ['BARCODE', 'MRP', 'BATCH_TRACKING', 'EXPIRY_TRACKING', 'FEFO', 'PRESCRIPTION'],
    attributes: [
      { key: 'generic_name', label: 'Generic Name', dataType: 'TEXT', showInList: true },
      { key: 'composition', label: 'Composition', dataType: 'TEXT' },
      { key: 'manufacturer', label: 'Manufacturer', dataType: 'TEXT', showInList: true },
      { key: 'schedule', label: 'Drug Schedule', dataType: 'SELECT', options: ['None', 'H', 'H1', 'X'] },
      ...BATCH_ATTRS,
    ],
    units: [...BASE_UNITS, UNIT.STRIP, UNIT.ML],
    categories: ['Tablets', 'Syrups', 'Injections', 'Ointments', 'Devices', 'OTC'],
    dashboardHighlights: ['EXPIRING', 'LOW_STOCK', 'SUPPLIER_DUE'],
    defaultTaxRates: [0, 5, 12, 18],
  },
  {
    code: 'ELECTRONICS',
    name: 'Electronics Store',
    description: 'Serial numbered goods with warranty tracking',
    icon: '🔌',
    sortOrder: 4,
    features: ['BARCODE', 'SERIAL_TRACKING', 'IMEI', 'WARRANTY', 'MRP', 'VARIANTS'],
    attributes: [
      { key: 'model', label: 'Model', dataType: 'TEXT', showInList: true },
      { key: 'warranty_months', label: 'Warranty (months)', dataType: 'NUMBER' },
      { key: 'power_rating', label: 'Power Rating', dataType: 'TEXT' },
    ],
    units: [...BASE_UNITS, UNIT.PAIR],
    categories: ['Mobiles', 'Appliances', 'Audio', 'Accessories', 'Computers'],
    dashboardHighlights: ['HIGH_VALUE_STOCK', 'CUSTOMER_DUE', 'LOW_STOCK'],
    defaultTaxRates: [12, 18, 28],
  },
  {
    code: 'STATIONERY',
    name: 'Stationery Store',
    description: 'Packs and loose pieces with unit conversion',
    icon: '✏️',
    sortOrder: 5,
    features: ['BARCODE', 'UNIT_CONVERSION', 'MRP', 'VARIANTS', 'BULK_PRICING'],
    attributes: [
      { key: 'pack_size', label: 'Pack Size', dataType: 'NUMBER' },
      { key: 'color', label: 'Colour', dataType: 'TEXT', appliesToVariant: true },
      { key: 'size', label: 'Size', dataType: 'TEXT', appliesToVariant: true },
    ],
    units: [...BASE_UNITS, UNIT.DOZEN, UNIT.M],
    categories: ['Notebooks', 'Pens', 'Art', 'Office', 'School'],
    dashboardHighlights: ['LOW_STOCK', 'TOP_SELLING'],
    defaultTaxRates: [0, 12, 18],
  },
  {
    code: 'BAKERY',
    name: 'Bakery',
    description: 'Recipes, production batches and wastage',
    icon: '🍰',
    sortOrder: 6,
    features: ['RECIPES', 'PRODUCTION', 'WASTAGE', 'BATCH_TRACKING', 'EXPIRY_TRACKING', 'LOOSE_QUANTITY', 'MRP'],
    attributes: [
      { key: 'shelf_life_days', label: 'Shelf Life (days)', dataType: 'NUMBER' },
      { key: 'eggless', label: 'Eggless', dataType: 'BOOLEAN' },
      ...BATCH_ATTRS,
    ],
    units: [...BASE_UNITS, UNIT.KG, UNIT.G, UNIT.L, UNIT.ML, UNIT.DOZEN],
    categories: ['Cakes', 'Breads', 'Pastries', 'Cookies', 'Ingredients'],
    dashboardHighlights: ['PRODUCTION_TODAY', 'WASTAGE', 'EXPIRING'],
    defaultTaxRates: [5, 18],
  },
  {
    code: 'BOUTIQUE',
    name: 'Boutique / Clothing',
    description: 'Size and colour variants with exchanges',
    icon: '👗',
    sortOrder: 7,
    features: ['BARCODE', 'VARIANTS', 'MRP', 'EXCHANGES'],
    attributes: [
      { key: 'size', label: 'Size', dataType: 'SELECT', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], appliesToVariant: true, showInList: true },
      { key: 'color', label: 'Colour', dataType: 'TEXT', appliesToVariant: true, showInList: true },
      { key: 'fabric', label: 'Fabric', dataType: 'TEXT' },
      { key: 'style', label: 'Style', dataType: 'TEXT' },
    ],
    units: [...BASE_UNITS, UNIT.PAIR, UNIT.M],
    categories: ['Kurtis', 'Sarees', 'Shirts', 'Trousers', 'Kids', 'Accessories'],
    dashboardHighlights: ['TOP_SELLING', 'RETURNS', 'LOW_STOCK'],
    defaultTaxRates: [5, 12],
  },
  {
    code: 'HARDWARE',
    name: 'Hardware Store',
    description: 'Boxes, pieces and bulk pricing',
    icon: '🔧',
    sortOrder: 8,
    features: ['BARCODE', 'UNIT_CONVERSION', 'BULK_PRICING', 'MRP'],
    attributes: [
      { key: 'dimensions', label: 'Dimensions', dataType: 'TEXT' },
      { key: 'material', label: 'Material', dataType: 'TEXT' },
      { key: 'pack_size', label: 'Pieces per Box', dataType: 'NUMBER' },
    ],
    units: [...BASE_UNITS, UNIT.KG, UNIT.M, UNIT.DOZEN, UNIT.PAIR],
    categories: ['Fasteners', 'Paints', 'Plumbing', 'Electrical', 'Tools'],
    dashboardHighlights: ['SUPPLIER_DUE', 'CUSTOMER_DUE', 'LOW_STOCK'],
    defaultTaxRates: [12, 18, 28],
  },
  {
    code: 'RESTAURANT',
    name: 'Small Restaurant',
    description: 'Menu items that consume ingredients automatically',
    icon: '🍽️',
    sortOrder: 9,
    features: ['RECIPES', 'PRODUCTION', 'WASTAGE', 'TABLE_MANAGEMENT', 'TAKEAWAY_DELIVERY', 'LOOSE_QUANTITY'],
    attributes: [
      { key: 'menu_section', label: 'Menu Section', dataType: 'TEXT', showInList: true },
      { key: 'spice_level', label: 'Spice Level', dataType: 'SELECT', options: ['Mild', 'Medium', 'Hot'] },
      { key: 'is_veg', label: 'Vegetarian', dataType: 'BOOLEAN', showInList: true },
    ],
    units: [...BASE_UNITS, UNIT.PLATE, UNIT.KG, UNIT.G, UNIT.L, UNIT.ML],
    categories: ['Starters', 'Main Course', 'Breads', 'Beverages', 'Desserts', 'Raw Material'],
    dashboardHighlights: ['TOP_SELLING', 'INGREDIENT_STOCK', 'WASTAGE'],
    defaultTaxRates: [5, 18],
  },
  {
    code: 'MOBILE_ACCESSORIES',
    name: 'Mobile Accessories',
    description: 'Compatibility, colours and warranty',
    icon: '📱',
    sortOrder: 10,
    features: ['BARCODE', 'VARIANTS', 'WARRANTY', 'COMPATIBILITY', 'MRP', 'SERIAL_TRACKING'],
    attributes: [
      { key: 'compatibility', label: 'Works With', dataType: 'TEXT', showInList: true },
      { key: 'color', label: 'Colour', dataType: 'TEXT', appliesToVariant: true },
      { key: 'warranty_months', label: 'Warranty (months)', dataType: 'NUMBER' },
    ],
    units: [...BASE_UNITS],
    categories: ['Cases', 'Chargers', 'Cables', 'Audio', 'Screen Guards', 'Power Banks'],
    dashboardHighlights: ['TOP_SELLING', 'LOW_STOCK'],
    defaultTaxRates: [18, 28],
  },
  {
    code: 'COSMETICS',
    name: 'Cosmetics Store',
    description: 'Shades, sizes, batches and expiry',
    icon: '💄',
    sortOrder: 11,
    features: ['BARCODE', 'VARIANTS', 'BATCH_TRACKING', 'EXPIRY_TRACKING', 'MRP'],
    attributes: [
      { key: 'shade', label: 'Shade', dataType: 'TEXT', appliesToVariant: true, showInList: true },
      { key: 'size', label: 'Size', dataType: 'TEXT', appliesToVariant: true },
      { key: 'skin_type', label: 'Skin Type', dataType: 'SELECT', options: ['All', 'Dry', 'Oily', 'Combination'] },
      ...BATCH_ATTRS,
    ],
    units: [...BASE_UNITS, UNIT.ML, UNIT.G],
    categories: ['Face', 'Lips', 'Eyes', 'Hair', 'Skin Care', 'Fragrance'],
    dashboardHighlights: ['EXPIRING', 'TOP_SELLING', 'LOW_STOCK'],
    defaultTaxRates: [18, 28],
  },
];

export const templateByCode = (code: string): BusinessTypeTemplate | undefined =>
  BUSINESS_TYPE_TEMPLATES.find((t) => t.code === code);

/** Effective features = business type template, then user overrides. */
export function resolveFeatures(
  businessType: string,
  overridesJson: string | null | undefined,
): Record<string, boolean> {
  const template = templateByCode(businessType);
  // Every key is answered, on or off, so the settings screen can list them
  // and a client never has to guess what an absent key means.
  const features: Record<string, boolean> = Object.fromEntries(FEATURE_KEYS.map((key) => [key, false]));
  for (const key of template?.features ?? []) features[key] = true;
  if (overridesJson) {
    try {
      const overrides = JSON.parse(overridesJson) as Record<string, boolean>;
      for (const [key, value] of Object.entries(overrides)) features[key] = Boolean(value);
    } catch {
      // A corrupt override blob must never break the shop; fall back to defaults.
    }
  }
  return features;
}
