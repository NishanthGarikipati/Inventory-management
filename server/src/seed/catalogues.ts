import type { BusinessTypeCode } from '../domain/enums.js';

/**
 * Demo catalogues, one per industry. Prices are in rupees and roughly match
 * Indian retail so the dashboard, profit and reports look believable.
 */
export interface SeedProduct {
  name: string;
  category: string;
  brand?: string;
  unit: string;
  purchase: number;
  selling: number;
  mrp?: number;
  stock: number;
  minStock: number;
  barcode?: string;
  batch?: { number: string; expiryMonths: number };
  serials?: string[];
  attributes?: Record<string, string>;
  variants?: Array<{ name: string; options: Record<string, string>; purchase?: number; selling?: number; stock: number }>;
  isIngredient?: boolean;
}

export interface SeedBusinessDefinition {
  type: BusinessTypeCode;
  name: string;
  ownerName: string;
  phone: string;
  address: string;
  products: SeedProduct[];
  suppliers: Array<{ name: string; phone: string; address?: string }>;
  customers: Array<{ name: string; phone: string; balance?: number }>;
  recipes?: Array<{ product: string; name: string; autoConsumeOnSale: boolean; items: Array<{ product: string; quantity: number }> }>;
}

const SUPPLIERS_GENERIC = [
  { name: 'ABC Distributors', phone: '9820011111', address: 'Market Road, Pune' },
  { name: 'Sharma Traders', phone: '9820022222', address: 'Station Road, Pune' },
  { name: 'Metro Wholesale', phone: '9820033333', address: 'MIDC, Pune' },
];

const CUSTOMERS_GENERIC = [
  { name: 'Ramesh Kumar', phone: '9900011111', balance: 250000 },
  { name: 'Sunita Sharma', phone: '9900022222' },
  { name: 'Imran Shaikh', phone: '9900033333', balance: 75000 },
  { name: 'Priya Patil', phone: '9900044444' },
  { name: 'Walk-in Customer', phone: '9900055555' },
];

export const SEED_BUSINESSES: SeedBusinessDefinition[] = [
  {
    type: 'KIRANA',
    name: 'Sri Lakshmi Kirana Store',
    ownerName: 'Venkatesh Rao',
    phone: '9000000001',
    address: 'Shop 3, Gandhi Bazaar, Bengaluru',
    suppliers: SUPPLIERS_GENERIC,
    customers: CUSTOMERS_GENERIC,
    products: [
      { name: 'Rice 5KG', category: 'Staples', brand: 'India Gate', unit: 'PCS', purchase: 300, selling: 320, mrp: 340, stock: 24, minStock: 10, barcode: '8901234500011' },
      { name: 'Sugar 1KG', category: 'Staples', unit: 'PCS', purchase: 45, selling: 52, mrp: 55, stock: 40, minStock: 15, barcode: '8901234500028' },
      { name: 'Sunflower Oil 1L', category: 'Staples', brand: 'Fortune', unit: 'PCS', purchase: 110, selling: 125, mrp: 130, stock: 18, minStock: 12, barcode: '8901234500035' },
      { name: 'Toor Dal 1KG', category: 'Staples', unit: 'PCS', purchase: 140, selling: 158, mrp: 165, stock: 16, minStock: 8 },
      { name: 'Wheat Atta 5KG', category: 'Staples', brand: 'Aashirvaad', unit: 'PCS', purchase: 245, selling: 290, mrp: 320, stock: 12, minStock: 6, barcode: '8901030865278' },
      { name: 'Tea Powder 250G', category: 'Beverages', brand: 'Red Label', unit: 'PCS', purchase: 105, selling: 125, mrp: 130, stock: 22, minStock: 10 },
      { name: 'Parle G Biscuit 250G', category: 'Snacks', brand: 'Parle', unit: 'PCS', purchase: 25, selling: 30, mrp: 30, stock: 60, minStock: 24, barcode: '8901234500059' },
      { name: 'Surf Excel Matic Front Load 2KG', category: 'Cleaning', brand: 'Surf Excel', unit: 'PCS', purchase: 420, selling: 465, mrp: 499, stock: 8, minStock: 4 },
      { name: 'Colgate Strong Teeth 200G', category: 'Personal Care', brand: 'Colgate', unit: 'PCS', purchase: 85, selling: 99, mrp: 105, stock: 15, minStock: 8 },
      { name: 'Amul Milk 500ML', category: 'Dairy', brand: 'Amul', unit: 'PCS', purchase: 24, selling: 28, mrp: 28, stock: 30, minStock: 20, batch: { number: 'AM0921', expiryMonths: 1 } },
      { name: 'Loose Groundnut', category: 'Staples', unit: 'KG', purchase: 120, selling: 150, stock: 25.5, minStock: 5 },
      { name: 'Salt 1KG', category: 'Staples', brand: 'Tata', unit: 'PCS', purchase: 20, selling: 25, mrp: 28, stock: 3, minStock: 10 },
    ],
  },
  {
    type: 'GROCERY',
    name: 'Fresh Mart Grocery',
    ownerName: 'Anita Deshmukh',
    phone: '9000000002',
    address: 'Lane 5, Koregaon Park, Pune',
    suppliers: SUPPLIERS_GENERIC,
    customers: CUSTOMERS_GENERIC,
    products: [
      { name: 'Tomato', category: 'Vegetables', unit: 'KG', purchase: 28, selling: 40, stock: 40, minStock: 10 },
      { name: 'Onion', category: 'Vegetables', unit: 'KG', purchase: 22, selling: 32, stock: 60, minStock: 15 },
      { name: 'Potato', category: 'Vegetables', unit: 'KG', purchase: 18, selling: 28, stock: 55, minStock: 15 },
      { name: 'Banana', category: 'Fruits', unit: 'DOZEN', purchase: 40, selling: 60, stock: 20, minStock: 5 },
      { name: 'Apple Shimla', category: 'Fruits', unit: 'KG', purchase: 120, selling: 160, stock: 18, minStock: 5 },
      { name: 'Amul Butter 500G', category: 'Dairy', brand: 'Amul', unit: 'PCS', purchase: 245, selling: 275, mrp: 285, stock: 12, minStock: 6, batch: { number: 'AB2291', expiryMonths: 4 } },
      { name: 'Curd 400G', category: 'Dairy', unit: 'PCS', purchase: 30, selling: 40, mrp: 42, stock: 24, minStock: 10, batch: { number: 'CD0921', expiryMonths: 1 } },
      { name: 'Brown Bread', category: 'Bakery', unit: 'PCS', purchase: 32, selling: 45, mrp: 45, stock: 10, minStock: 6, batch: { number: 'BB0921', expiryMonths: 1 } },
      { name: 'Basmati Rice 1KG', category: 'Staples', unit: 'PCS', purchase: 95, selling: 120, mrp: 130, stock: 22, minStock: 8 },
      { name: 'Frozen Peas 500G', category: 'Frozen', unit: 'PCS', purchase: 70, selling: 90, mrp: 95, stock: 14, minStock: 6 },
      { name: 'Eggs Tray 30', category: 'Dairy', unit: 'PCS', purchase: 180, selling: 210, stock: 9, minStock: 4 },
      { name: 'Coriander Bunch', category: 'Vegetables', unit: 'PCS', purchase: 8, selling: 15, stock: 0, minStock: 10 },
    ],
  },
  {
    type: 'MEDICAL',
    name: 'Jan Aushadhi Medicals',
    ownerName: 'Dr. Suresh Nair',
    phone: '9000000003',
    address: 'Near Civil Hospital, Nashik',
    suppliers: [
      { name: 'Mediline Pharma Distributors', phone: '9820044444' },
      { name: 'Apex Healthcare', phone: '9820055555' },
      { name: 'Sun Distributors', phone: '9820066666' },
    ],
    customers: CUSTOMERS_GENERIC,
    products: [
      { name: 'Paracetamol 500MG', category: 'Tablets', brand: 'Calpol', unit: 'STRIP', purchase: 12, selling: 18, mrp: 20, stock: 80, minStock: 30, batch: { number: 'P1231', expiryMonths: 8 }, attributes: { composition: 'Paracetamol 500mg', manufacturer: 'GSK', generic_name: 'Paracetamol' } },
      { name: 'Amoxicillin 250MG', category: 'Tablets', unit: 'STRIP', purchase: 48, selling: 62, mrp: 68, stock: 40, minStock: 20, batch: { number: 'AM7781', expiryMonths: 2 }, attributes: { composition: 'Amoxicillin 250mg', schedule: 'H' } },
      { name: 'Cough Syrup 100ML', category: 'Syrups', unit: 'PCS', purchase: 85, selling: 105, mrp: 112, stock: 25, minStock: 10, batch: { number: 'CS2231', expiryMonths: 10 } },
      { name: 'ORS Powder', category: 'OTC', unit: 'PCS', purchase: 18, selling: 25, mrp: 25, stock: 60, minStock: 25 },
      { name: 'Cetirizine 10MG', category: 'Tablets', unit: 'STRIP', purchase: 14, selling: 22, mrp: 24, stock: 50, minStock: 20, batch: { number: 'CZ1191', expiryMonths: 14 } },
      { name: 'Insulin Pen', category: 'Injections', unit: 'PCS', purchase: 620, selling: 720, mrp: 750, stock: 6, minStock: 3, batch: { number: 'IN4451', expiryMonths: 6 } },
      { name: 'Digital Thermometer', category: 'Devices', unit: 'PCS', purchase: 180, selling: 240, mrp: 260, stock: 8, minStock: 3 },
      { name: 'Antiseptic Cream 20G', category: 'Ointments', unit: 'PCS', purchase: 55, selling: 72, mrp: 78, stock: 18, minStock: 8 },
      { name: 'Vitamin D3 Sachet', category: 'OTC', unit: 'PCS', purchase: 32, selling: 45, mrp: 48, stock: 30, minStock: 12 },
      { name: 'Blood Pressure Monitor', category: 'Devices', unit: 'PCS', purchase: 1450, selling: 1750, mrp: 1899, stock: 3, minStock: 2 },
      { name: 'Surgical Mask Pack 50', category: 'OTC', unit: 'PACK', purchase: 120, selling: 160, mrp: 175, stock: 12, minStock: 5 },
      { name: 'Glucometer Strips 25', category: 'Devices', unit: 'PACK', purchase: 480, selling: 560, mrp: 600, stock: 5, minStock: 3, batch: { number: 'GS9981', expiryMonths: 5 } },
    ],
  },
  {
    type: 'ELECTRONICS',
    name: 'Sai Electronics',
    ownerName: 'Mahesh Kulkarni',
    phone: '9000000004',
    address: 'Main Road, Hubli',
    suppliers: SUPPLIERS_GENERIC,
    customers: CUSTOMERS_GENERIC,
    products: [
      { name: 'LED Bulb 9W', category: 'Appliances', brand: 'Philips', unit: 'PCS', purchase: 70, selling: 99, mrp: 120, stock: 60, minStock: 20 },
      { name: 'Ceiling Fan 1200MM', category: 'Appliances', brand: 'Crompton', unit: 'PCS', purchase: 1450, selling: 1750, mrp: 1899, stock: 8, minStock: 3, attributes: { model: 'HS Plus', warranty_months: '24' } },
      { name: 'Mixer Grinder 750W', category: 'Appliances', brand: 'Preethi', unit: 'PCS', purchase: 3200, selling: 3850, mrp: 4200, stock: 5, minStock: 2, attributes: { model: 'Eco Plus', warranty_months: '24' } },
      { name: 'Smartphone 128GB', category: 'Mobiles', brand: 'Redmi', unit: 'PCS', purchase: 11500, selling: 12999, mrp: 13999, stock: 4, minStock: 2, serials: ['IMEI863215470001', 'IMEI863215470002', 'IMEI863215470003', 'IMEI863215470004'], attributes: { model: 'Note 13', warranty_months: '12' } },
      { name: 'Bluetooth Speaker', category: 'Audio', brand: 'boAt', unit: 'PCS', purchase: 1150, selling: 1499, mrp: 1799, stock: 10, minStock: 4 },
      { name: 'Extension Board 6A', category: 'Accessories', unit: 'PCS', purchase: 210, selling: 280, mrp: 320, stock: 18, minStock: 6 },
      { name: 'USB Charger 33W', category: 'Accessories', unit: 'PCS', purchase: 480, selling: 649, mrp: 799, stock: 14, minStock: 5 },
      { name: 'Iron Box 1000W', category: 'Appliances', brand: 'Bajaj', unit: 'PCS', purchase: 720, selling: 899, mrp: 999, stock: 7, minStock: 3 },
      { name: 'Immersion Rod', category: 'Appliances', unit: 'PCS', purchase: 240, selling: 320, mrp: 360, stock: 9, minStock: 4 },
      { name: 'Wall Clock', category: 'Accessories', unit: 'PCS', purchase: 180, selling: 260, mrp: 299, stock: 12, minStock: 4 },
      { name: 'Laptop 14 inch i5', category: 'Computers', brand: 'HP', unit: 'PCS', purchase: 38000, selling: 43500, mrp: 46999, stock: 2, minStock: 1, serials: ['HPSN2291001', 'HPSN2291002'], attributes: { warranty_months: '12' } },
      { name: 'Power Bank 20000MAH', category: 'Accessories', unit: 'PCS', purchase: 1250, selling: 1599, mrp: 1799, stock: 6, minStock: 3 },
    ],
  },
  {
    type: 'STATIONERY',
    name: 'Vidya Stationers',
    ownerName: 'Ravi Verma',
    phone: '9000000005',
    address: 'College Road, Indore',
    suppliers: SUPPLIERS_GENERIC,
    customers: CUSTOMERS_GENERIC,
    products: [
      { name: 'Classmate Notebook 200 Pages', category: 'Notebooks', brand: 'Classmate', unit: 'PCS', purchase: 42, selling: 55, mrp: 60, stock: 120, minStock: 40 },
      { name: 'Reynolds Pen Blue', category: 'Pens', brand: 'Reynolds', unit: 'PCS', purchase: 7, selling: 10, mrp: 10, stock: 240, minStock: 100 },
      { name: 'Pencil Box Pack 10', category: 'School', unit: 'PACK', purchase: 40, selling: 60, mrp: 65, stock: 30, minStock: 10 },
      { name: 'A4 Paper Ream', category: 'Office', unit: 'PCS', purchase: 280, selling: 340, mrp: 360, stock: 16, minStock: 6 },
      { name: 'Geometry Box', category: 'School', unit: 'PCS', purchase: 85, selling: 120, mrp: 135, stock: 22, minStock: 8 },
      { name: 'Sketch Pens 12 Shades', category: 'Art', unit: 'PACK', purchase: 55, selling: 80, mrp: 90, stock: 26, minStock: 10 },
      { name: 'File Folder', category: 'Office', unit: 'PCS', purchase: 22, selling: 35, mrp: 40, stock: 45, minStock: 15 },
      { name: 'Stapler Medium', category: 'Office', unit: 'PCS', purchase: 95, selling: 130, mrp: 150, stock: 14, minStock: 5 },
      { name: 'Glue Stick', category: 'Art', unit: 'PCS', purchase: 18, selling: 30, mrp: 35, stock: 38, minStock: 12 },
      { name: 'Chart Paper', category: 'Art', unit: 'PCS', purchase: 8, selling: 15, mrp: 15, stock: 90, minStock: 30 },
      { name: 'Whiteboard Marker', category: 'Office', unit: 'PCS', purchase: 28, selling: 45, mrp: 50, stock: 34, minStock: 12 },
      { name: 'School Bag', category: 'School', unit: 'PCS', purchase: 450, selling: 650, mrp: 750, stock: 8, minStock: 3 },
    ],
  },
  {
    type: 'BAKERY',
    name: 'Sweet Crumbs Bakery',
    ownerName: 'Farida Khan',
    phone: '9000000006',
    address: 'MG Road, Kochi',
    suppliers: SUPPLIERS_GENERIC,
    customers: CUSTOMERS_GENERIC,
    products: [
      { name: 'Maida Flour', category: 'Ingredients', unit: 'KG', purchase: 42, selling: 55, stock: 50, minStock: 15, isIngredient: true },
      { name: 'Sugar', category: 'Ingredients', unit: 'KG', purchase: 45, selling: 55, stock: 40, minStock: 12, isIngredient: true },
      { name: 'Butter', category: 'Ingredients', unit: 'KG', purchase: 480, selling: 540, stock: 12, minStock: 4, isIngredient: true },
      { name: 'Eggs', category: 'Ingredients', unit: 'PCS', purchase: 7, selling: 9, stock: 180, minStock: 60, isIngredient: true },
      { name: 'Dark Chocolate', category: 'Ingredients', unit: 'KG', purchase: 620, selling: 700, stock: 8, minStock: 3, isIngredient: true },
      { name: 'Chocolate Cake 1KG', category: 'Cakes', unit: 'PCS', purchase: 0, selling: 650, mrp: 700, stock: 4, minStock: 2, batch: { number: 'CC2009', expiryMonths: 1 } },
      { name: 'Vanilla Pastry', category: 'Pastries', unit: 'PCS', purchase: 25, selling: 60, mrp: 60, stock: 20, minStock: 10, batch: { number: 'VP2009', expiryMonths: 1 } },
      { name: 'Brown Bread Loaf', category: 'Breads', unit: 'PCS', purchase: 22, selling: 45, mrp: 45, stock: 16, minStock: 8 },
      { name: 'Butter Cookies 250G', category: 'Cookies', unit: 'PCS', purchase: 70, selling: 120, mrp: 130, stock: 18, minStock: 6 },
      { name: 'Cream Puff', category: 'Pastries', unit: 'PCS', purchase: 15, selling: 35, stock: 24, minStock: 12 },
      { name: 'Birthday Cake 500G', category: 'Cakes', unit: 'PCS', purchase: 0, selling: 400, stock: 3, minStock: 2 },
      { name: 'Dinner Rolls Pack 6', category: 'Breads', unit: 'PACK', purchase: 30, selling: 55, stock: 12, minStock: 6 },
    ],
    recipes: [
      {
        product: 'Chocolate Cake 1KG',
        name: 'Chocolate Cake 1KG',
        autoConsumeOnSale: false,
        items: [
          { product: 'Maida Flour', quantity: 0.5 },
          { product: 'Sugar', quantity: 0.3 },
          { product: 'Butter', quantity: 0.2 },
          { product: 'Eggs', quantity: 6 },
          { product: 'Dark Chocolate', quantity: 0.15 },
        ],
      },
    ],
  },
  {
    type: 'BOUTIQUE',
    name: 'Rangoli Boutique',
    ownerName: 'Kavita Joshi',
    phone: '9000000007',
    address: 'Fashion Street, Surat',
    suppliers: SUPPLIERS_GENERIC,
    customers: CUSTOMERS_GENERIC,
    products: [
      {
        name: 'Cotton Kurti',
        category: 'Kurtis',
        unit: 'PCS',
        purchase: 450,
        selling: 899,
        mrp: 999,
        stock: 0,
        minStock: 2,
        variants: [
          { name: 'Red / S', options: { Size: 'S', Color: 'Red' }, stock: 4 },
          { name: 'Red / M', options: { Size: 'M', Color: 'Red' }, stock: 6 },
          { name: 'Red / L', options: { Size: 'L', Color: 'Red' }, stock: 3 },
          { name: 'Blue / M', options: { Size: 'M', Color: 'Blue' }, stock: 5 },
          { name: 'Blue / L', options: { Size: 'L', Color: 'Blue' }, stock: 2 },
        ],
      },
      { name: 'Silk Saree', category: 'Sarees', unit: 'PCS', purchase: 2200, selling: 3499, mrp: 3999, stock: 8, minStock: 3, attributes: { fabric: 'Silk' } },
      { name: 'Cotton Shirt', category: 'Shirts', unit: 'PCS', purchase: 380, selling: 699, mrp: 799, stock: 14, minStock: 5, attributes: { fabric: 'Cotton' } },
      { name: 'Denim Trouser', category: 'Trousers', unit: 'PCS', purchase: 620, selling: 1199, mrp: 1399, stock: 10, minStock: 4 },
      { name: 'Kids Frock', category: 'Kids', unit: 'PCS', purchase: 240, selling: 499, mrp: 549, stock: 12, minStock: 5 },
      { name: 'Dupatta', category: 'Accessories', unit: 'PCS', purchase: 150, selling: 349, mrp: 399, stock: 20, minStock: 8 },
      { name: 'Leggings', category: 'Trousers', unit: 'PCS', purchase: 180, selling: 349, mrp: 399, stock: 24, minStock: 10 },
      { name: 'Party Gown', category: 'Kurtis', unit: 'PCS', purchase: 1400, selling: 2499, mrp: 2999, stock: 4, minStock: 2 },
      { name: 'Nightwear Set', category: 'Kids', unit: 'PCS', purchase: 320, selling: 599, mrp: 699, stock: 9, minStock: 4 },
      { name: 'Handbag', category: 'Accessories', unit: 'PCS', purchase: 420, selling: 899, mrp: 999, stock: 7, minStock: 3 },
    ],
  },
  {
    type: 'HARDWARE',
    name: 'Bharat Hardware & Paints',
    ownerName: 'Sanjay Gupta',
    phone: '9000000008',
    address: 'Industrial Area, Ludhiana',
    suppliers: SUPPLIERS_GENERIC,
    customers: CUSTOMERS_GENERIC,
    products: [
      { name: 'Screws 2 inch Box 100', category: 'Fasteners', unit: 'BOX', purchase: 180, selling: 240, stock: 25, minStock: 8, attributes: { pack_size: '100' } },
      { name: 'Wall Paint 20L', category: 'Paints', brand: 'Asian Paints', unit: 'PCS', purchase: 4200, selling: 4950, mrp: 5200, stock: 6, minStock: 2 },
      { name: 'PVC Pipe 1 inch', category: 'Plumbing', unit: 'M', purchase: 65, selling: 90, stock: 120, minStock: 30 },
      { name: 'Electrical Wire 90M', category: 'Electrical', brand: 'Havells', unit: 'PCS', purchase: 1850, selling: 2250, mrp: 2400, stock: 9, minStock: 3 },
      { name: 'Hammer 500G', category: 'Tools', unit: 'PCS', purchase: 220, selling: 320, stock: 14, minStock: 5 },
      { name: 'Measuring Tape 5M', category: 'Tools', unit: 'PCS', purchase: 95, selling: 150, stock: 22, minStock: 8 },
      { name: 'Door Hinges Pair', category: 'Fasteners', unit: 'PAIR', purchase: 60, selling: 95, stock: 40, minStock: 12 },
      { name: 'Cement Bag 50KG', category: 'Tools', brand: 'UltraTech', unit: 'PCS', purchase: 380, selling: 430, stock: 30, minStock: 10 },
      { name: 'Paint Brush 3 inch', category: 'Paints', unit: 'PCS', purchase: 45, selling: 80, stock: 35, minStock: 12 },
      { name: 'LED Panel Light', category: 'Electrical', unit: 'PCS', purchase: 320, selling: 450, stock: 18, minStock: 6 },
      { name: 'Water Tap Brass', category: 'Plumbing', unit: 'PCS', purchase: 280, selling: 420, stock: 16, minStock: 6 },
      { name: 'Drill Machine 600W', category: 'Tools', unit: 'PCS', purchase: 2100, selling: 2650, mrp: 2899, stock: 4, minStock: 2 },
    ],
  },
  {
    type: 'RESTAURANT',
    name: 'Annapurna Family Restaurant',
    ownerName: 'Ganesh Pawar',
    phone: '9000000009',
    address: 'Highway Junction, Solapur',
    suppliers: SUPPLIERS_GENERIC,
    customers: CUSTOMERS_GENERIC,
    products: [
      { name: 'Rice Raw', category: 'Raw Material', unit: 'KG', purchase: 55, selling: 70, stock: 80, minStock: 20, isIngredient: true },
      { name: 'Paneer', category: 'Raw Material', unit: 'KG', purchase: 320, selling: 400, stock: 10, minStock: 4, isIngredient: true },
      { name: 'Tomato Puree', category: 'Raw Material', unit: 'KG', purchase: 60, selling: 80, stock: 15, minStock: 5, isIngredient: true },
      { name: 'Wheat Flour', category: 'Raw Material', unit: 'KG', purchase: 38, selling: 50, stock: 45, minStock: 15, isIngredient: true },
      { name: 'Cooking Oil', category: 'Raw Material', unit: 'L', purchase: 115, selling: 140, stock: 30, minStock: 10, isIngredient: true },
      { name: 'Paneer Butter Masala', category: 'Main Course', unit: 'PLATE', purchase: 0, selling: 240, stock: 0, minStock: 0, attributes: { menu_section: 'Main Course', is_veg: 'true' } },
      { name: 'Veg Biryani', category: 'Main Course', unit: 'PLATE', purchase: 0, selling: 180, stock: 0, minStock: 0, attributes: { menu_section: 'Main Course', is_veg: 'true' } },
      { name: 'Butter Naan', category: 'Breads', unit: 'PCS', purchase: 0, selling: 45, stock: 0, minStock: 0 },
      { name: 'Masala Chai', category: 'Beverages', unit: 'PCS', purchase: 0, selling: 25, stock: 0, minStock: 0 },
      { name: 'Gulab Jamun 2 Pcs', category: 'Desserts', unit: 'PLATE', purchase: 0, selling: 70, stock: 0, minStock: 0 },
      { name: 'Veg Manchurian', category: 'Starters', unit: 'PLATE', purchase: 0, selling: 160, stock: 0, minStock: 0 },
      { name: 'Cold Drink 300ML', category: 'Beverages', unit: 'PCS', purchase: 30, selling: 45, mrp: 45, stock: 48, minStock: 24 },
    ],
    recipes: [
      {
        product: 'Paneer Butter Masala',
        name: 'Paneer Butter Masala',
        autoConsumeOnSale: true,
        items: [
          { product: 'Paneer', quantity: 0.15 },
          { product: 'Tomato Puree', quantity: 0.1 },
          { product: 'Cooking Oil', quantity: 0.03 },
        ],
      },
      {
        product: 'Veg Biryani',
        name: 'Veg Biryani',
        autoConsumeOnSale: true,
        items: [
          { product: 'Rice Raw', quantity: 0.25 },
          { product: 'Cooking Oil', quantity: 0.04 },
        ],
      },
    ],
  },
  {
    type: 'MOBILE_ACCESSORIES',
    name: 'Mobile Point Accessories',
    ownerName: 'Arjun Reddy',
    phone: '9000000010',
    address: 'Bus Stand Road, Warangal',
    suppliers: SUPPLIERS_GENERIC,
    customers: CUSTOMERS_GENERIC,
    products: [
      { name: 'Tempered Glass Universal', category: 'Screen Guards', unit: 'PCS', purchase: 25, selling: 99, stock: 120, minStock: 40 },
      { name: 'Back Cover Silicone', category: 'Cases', unit: 'PCS', purchase: 45, selling: 149, stock: 90, minStock: 30, attributes: { compatibility: 'Redmi Note 13' } },
      { name: 'Type C Cable 1M', category: 'Cables', unit: 'PCS', purchase: 60, selling: 149, stock: 75, minStock: 25 },
      { name: 'Fast Charger 25W', category: 'Chargers', unit: 'PCS', purchase: 380, selling: 599, mrp: 699, stock: 22, minStock: 10 },
      { name: 'Wireless Earbuds', category: 'Audio', brand: 'boAt', unit: 'PCS', purchase: 950, selling: 1499, mrp: 1799, stock: 16, minStock: 6, attributes: { warranty_months: '12' } },
      { name: 'Power Bank 10000MAH', category: 'Power Banks', unit: 'PCS', purchase: 720, selling: 1099, mrp: 1299, stock: 12, minStock: 5 },
      { name: 'Car Mobile Holder', category: 'Cases', unit: 'PCS', purchase: 110, selling: 249, stock: 25, minStock: 10 },
      { name: 'Selfie Stick', category: 'Cases', unit: 'PCS', purchase: 140, selling: 299, stock: 14, minStock: 6 },
      { name: 'OTG Adapter', category: 'Cables', unit: 'PCS', purchase: 30, selling: 79, stock: 60, minStock: 20 },
      { name: 'Wired Earphones', category: 'Audio', unit: 'PCS', purchase: 85, selling: 199, stock: 40, minStock: 15 },
      { name: 'Memory Card 64GB', category: 'Cables', unit: 'PCS', purchase: 420, selling: 599, mrp: 699, stock: 18, minStock: 8 },
      { name: 'Mobile Stand', category: 'Cases', unit: 'PCS', purchase: 55, selling: 149, stock: 30, minStock: 12 },
    ],
  },
  {
    type: 'COSMETICS',
    name: 'Glow Beauty Store',
    ownerName: 'Neha Agarwal',
    phone: '9000000011',
    address: 'City Centre Mall, Jaipur',
    suppliers: SUPPLIERS_GENERIC,
    customers: CUSTOMERS_GENERIC,
    products: [
      {
        name: 'Matte Lipstick',
        category: 'Lips',
        brand: 'Lakme',
        unit: 'PCS',
        purchase: 220,
        selling: 375,
        mrp: 399,
        stock: 0,
        minStock: 3,
        variants: [
          { name: 'Ruby Red', options: { Shade: 'Ruby Red' }, stock: 8 },
          { name: 'Nude Pink', options: { Shade: 'Nude Pink' }, stock: 6 },
          { name: 'Coral', options: { Shade: 'Coral' }, stock: 4 },
        ],
      },
      { name: 'Compact Powder 9G', category: 'Face', brand: 'Maybelline', unit: 'PCS', purchase: 280, selling: 425, mrp: 450, stock: 14, minStock: 5, batch: { number: 'CP2291', expiryMonths: 18 } },
      { name: 'Kajal Pencil', category: 'Eyes', unit: 'PCS', purchase: 90, selling: 165, mrp: 180, stock: 26, minStock: 10, batch: { number: 'KP2291', expiryMonths: 12 } },
      { name: 'Face Wash 100ML', category: 'Skin Care', brand: 'Himalaya', unit: 'PCS', purchase: 105, selling: 155, mrp: 165, stock: 30, minStock: 12 },
      { name: 'Hair Serum 50ML', category: 'Hair', unit: 'PCS', purchase: 240, selling: 375, mrp: 399, stock: 11, minStock: 4 },
      { name: 'Sunscreen SPF50', category: 'Skin Care', unit: 'PCS', purchase: 320, selling: 469, mrp: 499, stock: 9, minStock: 4, batch: { number: 'SS2291', expiryMonths: 20 } },
      { name: 'Nail Polish', category: 'Face', unit: 'PCS', purchase: 60, selling: 120, mrp: 135, stock: 44, minStock: 15 },
      { name: 'Perfume 50ML', category: 'Fragrance', unit: 'PCS', purchase: 480, selling: 799, mrp: 899, stock: 8, minStock: 3 },
      { name: 'Face Cream 50G', category: 'Skin Care', unit: 'PCS', purchase: 140, selling: 225, mrp: 249, stock: 18, minStock: 8, batch: { number: 'FC2291', expiryMonths: 14 } },
      { name: 'Shampoo 340ML', category: 'Hair', brand: 'Dove', unit: 'PCS', purchase: 265, selling: 375, mrp: 399, stock: 16, minStock: 6 },
    ],
  },
];
