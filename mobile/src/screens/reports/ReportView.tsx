import type { ReactNode } from 'react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '../../components/AppShell';
import {
  Badge,
  Card,
  ChipRow,
  Empty,
  ErrorNotice,
  ListRow,
  Loading,
  Screen,
  StatTile,
  TotalsRow,
} from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { dateLabel, dateTimeLabel, money, percent, quantity as qtyLabel } from '../../lib/format';
import { RANGE_OPTIONS, type RangeKey } from '../../lib/ranges';
import { toast } from '../../lib/toast';
import { useSession } from '../../store/session';
import type { InventoryRow } from '../../lib/types';

/* ---------- What the server sends ---------- */

interface Range {
  start: string;
  end: string;
  label: string;
}

interface SalesReport {
  range: Range;
  totals: {
    salesPaise: number;
    billCount: number;
    grossProfitPaise: number;
    taxPaise: number;
    discountPaise: number;
    duePaise: number;
    averageBillPaise: number;
  };
  byDay: Array<{ date: string; salesPaise: number; bills: number; profitPaise: number }>;
  byPaymentMethod: Record<string, number>;
}

interface ProductSalesReport {
  products: Array<{ variantId: string; name: string; quantity: number; revenuePaise: number; profitPaise: number }>;
}

interface CategorySalesReport {
  categories: Array<{ category: string; revenuePaise: number; quantity: number; profitPaise: number }>;
}

interface PurchaseReport {
  range: Range;
  totals: { purchasePaise: number; count: number; duePaise: number };
  bySupplier: Array<{ supplier: string; totalPaise: number; count: number; duePaise: number }>;
}

interface InventoryReport {
  items: Array<{
    variantId: string;
    name: string;
    category: string;
    quantity: number;
    minStock: number;
    avgCostPaise: number;
    stockValuePaise: number;
    sellingPricePaise: number;
  }>;
  totals: { products: number; stockValuePaise: number; retailValuePaise: number };
}

interface StockListReport {
  items: InventoryRow[];
  total: number;
  summary: { stockValuePaise: number; lowStock: number; outOfStock: number; expiringSoon: number };
}

interface OutstandingReport {
  customers: Array<{ id: string; name: string; phone: string | null; balancePaise: number }>;
  suppliers: Array<{ id: string; name: string; phone: string | null; balancePaise: number }>;
  totals: { customerDuePaise: number; supplierDuePaise: number };
}

interface ProfitReport {
  range: Range;
  revenuePaise: number;
  returnsPaise: number;
  cogsPaise: number;
  grossProfitPaise: number;
  expensesPaise: number;
  estimatedNetProfitPaise: number;
  taxCollectedPaise: number;
  discountGivenPaise: number;
}

interface ExpenseReport {
  range: Range;
  totalPaise: number;
  byCategory: Array<{ category: string; amountPaise: number }>;
  count: number;
}

interface PaymentReport {
  range: Range;
  salesByMethod: Record<string, number>;
  customerCollectionPaise: number;
  customerCollectionCount: number;
  supplierPaidPaise: number;
  supplierPaidCount: number;
}

interface StockMovementReport {
  range: Range;
  byType: Record<string, number>;
  transactions: Array<{
    id: string;
    date: string;
    product: string;
    type: string;
    quantity: number;
    previousStock: number;
    newStock: number;
    source: string;
    referenceType: string | null;
    referenceId: string | null;
  }>;
}

interface ScanReport {
  range: Range;
  scans: Array<{
    id: string;
    type: string;
    status: string;
    supplier: string | null;
    itemCount: number;
    confidence: number;
    createdAt: string;
    approvedAt: string | null;
    resultRefType: string | null;
    resultRefId: string | null;
  }>;
  totals: { total: number; approved: number; pending: number; rejected: number; failed: number };
}

interface SalesReturnsReport {
  returns: Array<{
    id: string;
    returnNumber: string;
    reason: string;
    refundMethod: string;
    totalPaise: number;
    refundPaise: number;
    createdAt: string;
    customer: { id: string; name: string } | null;
    sale: { invoiceNumber: string } | null;
    items: Array<{ id: string }>;
  }>;
}

interface PurchaseReturnsReport {
  returns: Array<{
    id: string;
    returnNumber: string;
    reason: string;
    settlement: string;
    totalPaise: number;
    createdAt: string;
    supplier: { id: string; name: string } | null;
    items: Array<{ id: string }>;
  }>;
}

/* ---------- Labels ---------- */

const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  CREDIT: 'On credit',
  OTHER: 'Other',
};

const MOVEMENT_LABEL: Record<string, string> = {
  OPENING: 'Opening stock',
  PURCHASE: 'Bought',
  SALE: 'Sold',
  SALE_RETURN: 'Customer return',
  PURCHASE_RETURN: 'Returned to supplier',
  ADJUSTMENT: 'Adjustment',
  DAMAGE: 'Damage',
  EXPIRY: 'Expired',
  TRANSFER: 'Transfer',
  PRODUCTION: 'Made',
  CONSUMPTION: 'Used in recipe',
  IMAGE_SCAN_ADJUSTMENT: 'From scanned photo',
};

const SCAN_TYPE_LABEL: Record<string, string> = {
  INVOICE: 'Invoice',
  RECEIPT: 'Receipt',
  PRODUCT: 'Product label',
  SHELF: 'Shelf photo',
  STOCK_SHEET: 'Stock sheet',
};

const SCAN_STATUS: Record<string, { tone: 'green' | 'amber' | 'red' | 'grey' | 'blue'; label: string }> = {
  APPROVED: { tone: 'green', label: 'Confirmed' },
  REVIEW_REQUIRED: { tone: 'amber', label: 'Needs review' },
  EXTRACTED: { tone: 'blue', label: 'Read' },
  REJECTED: { tone: 'grey', label: 'Cancelled' },
  FAILED: { tone: 'red', label: 'Could not read' },
  UPLOADED: { tone: 'grey', label: 'Uploaded' },
  PROCESSING: { tone: 'blue', label: 'Reading' },
};

const SCAN_RESULT_LABEL: Record<string, string> = {
  Purchase: 'Purchase entry made',
  StockAdjustment: 'Stock corrected',
  Product: 'New products added',
};

/* ---------- Small building blocks ---------- */

interface BarRow {
  label: string;
  value: number;
  display: string;
}

/** A comparison the owner can read in one glance: longest bar sold the most. */
function Bars({ rows }: { rows: BarRow[] }) {
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.value)));
  return (
    <div className="bar-chart">
      {rows.map((row) => (
        <div className="bar-row" key={row.label}>
          <div className="bar-label">
            <span>{row.label}</span>
            <strong>{row.display}</strong>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${Math.round((Math.abs(row.value) / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const TrimNote = ({ shown, total }: { shown: number; total: number }) =>
  total > shown ? (
    <p className="muted" style={{ marginTop: 10 }}>
      Showing the top {shown} of {total}. Copy the report for the full list.
    </p>
  ) : null;

const MAX_ROWS = 60;

const methodBars = (byMethod: Record<string, number>): BarRow[] =>
  Object.entries(byMethod)
    .filter(([, value]) => value !== 0)
    .sort((a, b) => b[1] - a[1])
    .map(([method, value]) => ({ label: PAYMENT_LABEL[method] ?? method, value, display: money(value) }));

const figure = (label: string, value: string): string => `${label}: ${value}`;

/* ---------- The report map ---------- */

interface ReportContext {
  navigate: (to: string) => void;
  taxLabel: string;
}

interface Report {
  title: string;
  description: string;
  endpoint: string;
  permission: string;
  /** Stock and dues describe this moment, so the date chips are hidden for them. */
  dated: boolean;
  defaultRange: RangeKey;
  query?: Record<string, string | number>;
  render: (data: unknown, context: ReportContext) => ReactNode;
  copyText: (data: unknown) => string;
}

/**
 * Each report declares its own response shape once, here, so the renderer and
 * the WhatsApp text below it can never drift from what the server sends.
 */
function defineReport<T>(spec: {
  title: string;
  description: string;
  endpoint: string;
  permission?: string;
  dated?: boolean;
  defaultRange?: RangeKey;
  query?: Record<string, string | number>;
  render: (data: T, context: ReportContext) => ReactNode;
  copyText: (data: T) => string;
}): Report {
  return {
    title: spec.title,
    description: spec.description,
    endpoint: spec.endpoint,
    permission: spec.permission ?? 'report:read',
    dated: spec.dated ?? true,
    defaultRange: spec.defaultRange ?? 'TODAY',
    query: spec.query,
    render: (data, context) => spec.render(data as T, context),
    copyText: (data) => spec.copyText(data as T),
  };
}

const salesReport = (title: string, description: string, defaultRange: RangeKey) =>
  defineReport<SalesReport>({
    title,
    description,
    endpoint: '/reports/sales',
    defaultRange,
    render: (data, context) => {
      const days = data.byDay.slice(-31);
      return (
        <>
          <div className="stat-grid">
            <StatTile
              label="Sales"
              value={money(data.totals.salesPaise)}
              note={`${data.totals.billCount} ${data.totals.billCount === 1 ? 'bill' : 'bills'}`}
              accent
            />
            <StatTile label="Average bill" value={money(data.totals.averageBillPaise)} />
            <StatTile label="Gross profit" value={money(data.totals.grossProfitPaise)} note="Before expenses" />
            <StatTile label="Given on credit" value={money(data.totals.duePaise)} note="Still to collect" />
          </div>

          {days.length ? (
            <Card title="Day by day">
              <Bars
                rows={days.map((day) => ({
                  label: dateLabel(day.date),
                  value: day.salesPaise,
                  display: money(day.salesPaise),
                }))}
              />
              <TrimNote shown={days.length} total={data.byDay.length} />
            </Card>
          ) : null}

          {methodBars(data.byPaymentMethod).length ? (
            <Card title="How the money came in">
              <Bars rows={methodBars(data.byPaymentMethod)} />
            </Card>
          ) : null}

          <Card title="Also on these bills">
            <TotalsRow label={context.taxLabel} value={money(data.totals.taxPaise)} />
            <TotalsRow label="Discount given" value={money(data.totals.discountPaise)} />
          </Card>
        </>
      );
    },
    copyText: (data) =>
      [
        figure('Sales', money(data.totals.salesPaise)),
        figure('Bills', String(data.totals.billCount)),
        figure('Average bill', money(data.totals.averageBillPaise)),
        figure('Gross profit', money(data.totals.grossProfitPaise)),
        figure('Given on credit', money(data.totals.duePaise)),
        '',
        ...methodBars(data.byPaymentMethod).map((row) => figure(row.label, row.display)),
      ].join('\n'),
  });

const stockListReport = (
  title: string,
  description: string,
  status: 'LOW_STOCK' | 'OUT_OF_STOCK',
  empty: { title: string; hint: string },
) =>
  defineReport<StockListReport>({
    title,
    description,
    endpoint: '/inventory',
    permission: 'inventory:read',
    dated: false,
    query: { status, pageSize: 200 },
    render: (data, context) => (
      <>
        <div className="stat-grid">
          <StatTile label="Low stock" value={String(data.summary.lowStock)} note="Running out" accent={status === 'LOW_STOCK'} />
          <StatTile
            label="Out of stock"
            value={String(data.summary.outOfStock)}
            note="Nothing left"
            accent={status === 'OUT_OF_STOCK'}
          />
        </div>

        {data.items.length ? (
          <div className="list">
            {data.items.slice(0, MAX_ROWS).map((row) => (
              <ListRow
                key={row.variantId}
                title={row.name}
                subtitle={`${row.category ?? 'Uncategorised'} · ${money(row.sellingPricePaise)}`}
                amount={`${qtyLabel(row.quantity)} ${row.unit.toLowerCase()}`}
                note={row.minStock ? `Keep ${qtyLabel(row.minStock)}` : undefined}
                onClick={() => context.navigate(`/stock/${row.variantId}`)}
              />
            ))}
          </div>
        ) : (
          <Empty icon="✅" title={empty.title} hint={empty.hint} />
        )}
        <TrimNote shown={Math.min(MAX_ROWS, data.items.length)} total={data.items.length} />
      </>
    ),
    copyText: (data) =>
      data.items.length
        ? data.items
            .slice(0, MAX_ROWS)
            .map((row) => `${row.name}: ${qtyLabel(row.quantity)} ${row.unit.toLowerCase()} left`)
            .join('\n')
        : 'Nothing to buy right now.',
  });

export const REPORTS: Record<string, Report> = {
  'daily-sales': salesReport('Daily Sales', 'What sold and how much money came in', 'TODAY'),
  'monthly-sales': salesReport('Monthly Sales', 'The whole month on one screen', 'THIS_MONTH'),

  'sales-by-product': defineReport<ProductSalesReport>({
    title: 'Sales by Product',
    description: 'Which products are selling and which are not',
    endpoint: '/reports/sales/products',
    defaultRange: 'THIS_MONTH',
    query: { limit: 100 },
    render: (data) => {
      if (!data.products.length) return <Empty icon="🏷️" title="No sales yet" hint="Nothing was sold in this period." />;
      return (
        <Card title="Top sellers">
          <table className="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Sold</th>
                <th className="num">Sales</th>
                <th className="num">Profit</th>
              </tr>
            </thead>
            <tbody>
              {data.products.slice(0, MAX_ROWS).map((product) => (
                <tr key={product.variantId}>
                  <td>{product.name}</td>
                  <td className="num">{qtyLabel(product.quantity)}</td>
                  <td className="num">{money(product.revenuePaise)}</td>
                  <td className="num">{money(product.profitPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <TrimNote shown={Math.min(MAX_ROWS, data.products.length)} total={data.products.length} />
        </Card>
      );
    },
    copyText: (data) =>
      data.products.length
        ? data.products
            .slice(0, MAX_ROWS)
            .map((product) => `${product.name}: ${qtyLabel(product.quantity)} sold, ${money(product.revenuePaise)}`)
            .join('\n')
        : 'No sales in this period.',
  }),

  'sales-by-category': defineReport<CategorySalesReport>({
    title: 'Sales by Category',
    description: 'Which part of the shop earns the most',
    endpoint: '/reports/sales/categories',
    defaultRange: 'THIS_MONTH',
    render: (data) => {
      if (!data.categories.length) return <Empty icon="📚" title="No sales yet" hint="Nothing was sold in this period." />;
      const total = data.categories.reduce((sum, row) => sum + row.revenuePaise, 0);
      return (
        <>
          <div className="stat-grid">
            <StatTile label="Total sales" value={money(total)} note={`${data.categories.length} categories`} accent />
            <StatTile label="Biggest" value={data.categories[0].category} note={money(data.categories[0].revenuePaise)} />
          </div>
          <Card title="Share of sales">
            <Bars
              rows={data.categories.map((row) => ({
                label: row.category,
                value: row.revenuePaise,
                display: money(row.revenuePaise),
              }))}
            />
          </Card>
          <Card title="Category by category">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">Sold</th>
                  <th className="num">Sales</th>
                  <th className="num">Profit</th>
                </tr>
              </thead>
              <tbody>
                {data.categories.map((row) => (
                  <tr key={row.category}>
                    <td>{row.category}</td>
                    <td className="num">{qtyLabel(row.quantity)}</td>
                    <td className="num">{money(row.revenuePaise)}</td>
                    <td className="num">{money(row.profitPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      );
    },
    copyText: (data) =>
      data.categories.length
        ? data.categories.map((row) => figure(row.category, money(row.revenuePaise))).join('\n')
        : 'No sales in this period.',
  }),

  purchases: defineReport<PurchaseReport>({
    title: 'Purchases',
    description: 'Goods you bought and what is still unpaid',
    endpoint: '/reports/purchases',
    defaultRange: 'THIS_MONTH',
    render: (data) => (
      <>
        <div className="stat-grid">
          <StatTile
            label="Purchases"
            value={money(data.totals.purchasePaise)}
            note={`${data.totals.count} ${data.totals.count === 1 ? 'entry' : 'entries'}`}
            accent
          />
          <StatTile label="Still to pay" value={money(data.totals.duePaise)} note="Supplier due" />
        </div>
        {data.bySupplier.length ? (
          <Card title="Supplier by supplier">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="num">Entries</th>
                  <th className="num">Bought</th>
                  <th className="num">Unpaid</th>
                </tr>
              </thead>
              <tbody>
                {data.bySupplier.map((row) => (
                  <tr key={row.supplier}>
                    <td>{row.supplier}</td>
                    <td className="num">{row.count}</td>
                    <td className="num">{money(row.totalPaise)}</td>
                    <td className="num">{money(row.duePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : (
          <Empty icon="📥" title="No purchases" hint="Nothing was bought in this period." />
        )}
      </>
    ),
    copyText: (data) =>
      [
        figure('Purchases', money(data.totals.purchasePaise)),
        figure('Entries', String(data.totals.count)),
        figure('Still to pay', money(data.totals.duePaise)),
        '',
        ...data.bySupplier.map((row) => figure(row.supplier, money(row.totalPaise))),
      ].join('\n'),
  }),

  inventory: defineReport<InventoryReport>({
    title: 'Stock on Hand',
    description: 'Everything on the shelf and what it is worth',
    endpoint: '/reports/inventory',
    dated: false,
    render: (data) => (
      <>
        <div className="stat-grid">
          <StatTile label="Stock value" value={money(data.totals.stockValuePaise)} note="At cost" accent />
          <StatTile label="If it all sells" value={money(data.totals.retailValuePaise)} note="At selling price" />
          <StatTile label="Products" value={String(data.totals.products)} />
          <StatTile
            label="Expected earning"
            value={money(data.totals.retailValuePaise - data.totals.stockValuePaise)}
            note="Before tax and expenses"
          />
        </div>
        {data.items.length ? (
          <Card title="Highest value first">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Left</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {data.items.slice(0, MAX_ROWS).map((item) => (
                  <tr key={item.variantId}>
                    <td>{item.name}</td>
                    <td className="num">{qtyLabel(item.quantity)}</td>
                    <td className="num">{money(item.stockValuePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TrimNote shown={Math.min(MAX_ROWS, data.items.length)} total={data.items.length} />
          </Card>
        ) : (
          <Empty icon="📦" title="No stock yet" hint="Add products and record a purchase." />
        )}
      </>
    ),
    copyText: (data) =>
      [
        figure('Stock value at cost', money(data.totals.stockValuePaise)),
        figure('Value at selling price', money(data.totals.retailValuePaise)),
        figure('Products', String(data.totals.products)),
      ].join('\n'),
  }),

  'low-stock': stockListReport('Low Stock', 'What to buy before it runs out', 'LOW_STOCK', {
    title: 'Nothing is low',
    hint: 'Every product is above its minimum.',
  }),

  'out-of-stock': stockListReport('Out of Stock', 'What you cannot sell right now', 'OUT_OF_STOCK', {
    title: 'Nothing is finished',
    hint: 'Every product still has stock.',
  }),

  'customer-outstanding': defineReport<OutstandingReport>({
    title: 'Customer Due',
    description: 'Who owes you money',
    endpoint: '/reports/outstanding',
    dated: false,
    render: (data, context) => (
      <>
        <div className="stat-grid">
          <StatTile
            label="To collect"
            value={money(data.totals.customerDuePaise)}
            note={`${data.customers.length} ${data.customers.length === 1 ? 'customer' : 'customers'}`}
            accent
          />
          <StatTile label="Biggest" value={money(data.customers[0]?.balancePaise ?? 0)} note={data.customers[0]?.name} />
        </div>
        {data.customers.length ? (
          <div className="list">
            {data.customers.slice(0, MAX_ROWS).map((customer) => (
              <ListRow
                key={customer.id}
                avatar="👤"
                title={customer.name}
                subtitle={customer.phone ?? 'No number'}
                amount={money(customer.balancePaise)}
                note="due"
                onClick={() => context.navigate(`/customers/${customer.id}`)}
              />
            ))}
          </div>
        ) : (
          <Empty icon="✅" title="Nothing pending" hint="No customer owes you money." />
        )}
        <TrimNote shown={Math.min(MAX_ROWS, data.customers.length)} total={data.customers.length} />
      </>
    ),
    copyText: (data) =>
      [
        figure('Total to collect', money(data.totals.customerDuePaise)),
        '',
        ...data.customers.slice(0, MAX_ROWS).map((customer) => figure(customer.name, money(customer.balancePaise))),
      ].join('\n'),
  }),

  'supplier-outstanding': defineReport<OutstandingReport>({
    title: 'Supplier Due',
    description: 'Who you have to pay',
    endpoint: '/reports/outstanding',
    dated: false,
    render: (data, context) => (
      <>
        <div className="stat-grid">
          <StatTile
            label="To pay"
            value={money(data.totals.supplierDuePaise)}
            note={`${data.suppliers.length} ${data.suppliers.length === 1 ? 'supplier' : 'suppliers'}`}
            accent
          />
          <StatTile label="Biggest" value={money(data.suppliers[0]?.balancePaise ?? 0)} note={data.suppliers[0]?.name} />
        </div>
        {data.suppliers.length ? (
          <div className="list">
            {data.suppliers.slice(0, MAX_ROWS).map((supplier) => (
              <ListRow
                key={supplier.id}
                avatar="🚚"
                title={supplier.name}
                subtitle={supplier.phone ?? 'No number'}
                amount={money(supplier.balancePaise)}
                note="to pay"
                onClick={() => context.navigate(`/suppliers/${supplier.id}`)}
              />
            ))}
          </div>
        ) : (
          <Empty icon="✅" title="Nothing pending" hint="You do not owe any supplier." />
        )}
        <TrimNote shown={Math.min(MAX_ROWS, data.suppliers.length)} total={data.suppliers.length} />
      </>
    ),
    copyText: (data) =>
      [
        figure('Total to pay', money(data.totals.supplierDuePaise)),
        '',
        ...data.suppliers.slice(0, MAX_ROWS).map((supplier) => figure(supplier.name, money(supplier.balancePaise))),
      ].join('\n'),
  }),

  expenses: defineReport<ExpenseReport>({
    title: 'Expenses',
    description: 'Rent, salary, transport and the rest',
    endpoint: '/reports/expenses',
    defaultRange: 'THIS_MONTH',
    render: (data) => (
      <>
        <div className="stat-grid">
          <StatTile
            label="Spent"
            value={money(data.totalPaise)}
            note={`${data.count} ${data.count === 1 ? 'entry' : 'entries'}`}
            accent
          />
          <StatTile
            label="Biggest head"
            value={data.byCategory[0]?.category ?? '—'}
            note={data.byCategory.length ? money(data.byCategory[0].amountPaise) : undefined}
          />
        </div>
        {data.byCategory.length ? (
          <Card title="Where it went">
            <Bars
              rows={[...data.byCategory]
                .sort((a, b) => b.amountPaise - a.amountPaise)
                .map((row) => ({ label: row.category, value: row.amountPaise, display: money(row.amountPaise) }))}
            />
          </Card>
        ) : (
          <Empty icon="🧾" title="No expenses" hint="Nothing was recorded in this period." />
        )}
      </>
    ),
    copyText: (data) =>
      [
        figure('Total spent', money(data.totalPaise)),
        '',
        ...data.byCategory.map((row) => figure(row.category, money(row.amountPaise))),
      ].join('\n'),
  }),

  profit: defineReport<ProfitReport>({
    title: 'Gross Profit',
    description: 'Sales minus cost of goods, then minus expenses',
    endpoint: '/reports/profit',
    defaultRange: 'THIS_MONTH',
    render: (data, context) => (
      <>
        <div className="stat-grid">
          <StatTile label="Gross profit" value={money(data.grossProfitPaise)} note="Before expenses" accent />
          <StatTile
            label="Estimated net profit"
            value={money(data.estimatedNetProfitPaise)}
            note="After expenses and returns"
          />
        </div>

        <Card title="How it adds up">
          <TotalsRow label="Revenue (without tax)" value={money(data.revenuePaise)} />
          <TotalsRow label="Cost of goods sold" value={`− ${money(data.cogsPaise)}`} />
          <TotalsRow label="Gross profit" value={money(data.grossProfitPaise)} />
          <TotalsRow label="Returns" value={`− ${money(data.returnsPaise)}`} />
          <TotalsRow label="Expenses" value={`− ${money(data.expensesPaise)}`} />
          <TotalsRow label="Estimated net profit" value={money(data.estimatedNetProfitPaise)} grand />
        </Card>

        <Card title="Also in this period">
          <TotalsRow label={`${context.taxLabel} collected`} value={money(data.taxCollectedPaise)} />
          <TotalsRow label="Discount given" value={money(data.discountGivenPaise)} />
        </Card>

        <p className="muted">
          Gross profit is what you sold minus what those goods cost you. The net profit line is an estimate: it takes off
          shop expenses and returns, but it is not an audited account.
        </p>
      </>
    ),
    copyText: (data) =>
      [
        figure('Revenue (without tax)', money(data.revenuePaise)),
        figure('Cost of goods sold', money(data.cogsPaise)),
        figure('Gross profit', money(data.grossProfitPaise)),
        figure('Returns', money(data.returnsPaise)),
        figure('Expenses', money(data.expensesPaise)),
        figure('Estimated net profit', money(data.estimatedNetProfitPaise)),
      ].join('\n'),
  }),

  payments: defineReport<PaymentReport>({
    title: 'Payment Summary',
    description: 'Cash, UPI, card and what you collected',
    endpoint: '/reports/payments',
    defaultRange: 'TODAY',
    render: (data) => {
      const bars = methodBars(data.salesByMethod);
      const billed = bars.reduce((sum, row) => sum + row.value, 0);
      return (
        <>
          <div className="stat-grid">
            <StatTile label="Taken on bills" value={money(billed)} accent />
            <StatTile
              label="Collected from customers"
              value={money(data.customerCollectionPaise)}
              note={`${data.customerCollectionCount} ${data.customerCollectionCount === 1 ? 'entry' : 'entries'}`}
            />
            <StatTile
              label="Paid to suppliers"
              value={money(data.supplierPaidPaise)}
              note={`${data.supplierPaidCount} ${data.supplierPaidCount === 1 ? 'entry' : 'entries'}`}
            />
            <StatTile
              label="Net into the shop"
              value={money(billed + data.customerCollectionPaise - data.supplierPaidPaise)}
            />
          </div>
          {bars.length ? (
            <Card title="On bills, by payment type">
              <Bars rows={bars} />
            </Card>
          ) : (
            <Empty icon="💵" title="No payments" hint="Nothing was taken in this period." />
          )}
        </>
      );
    },
    copyText: (data) =>
      [
        ...methodBars(data.salesByMethod).map((row) => figure(row.label, row.display)),
        '',
        figure('Collected from customers', money(data.customerCollectionPaise)),
        figure('Paid to suppliers', money(data.supplierPaidPaise)),
      ].join('\n'),
  }),

  'sales-returns': defineReport<SalesReturnsReport>({
    title: 'Sales Returns',
    description: 'Goods customers brought back',
    endpoint: '/returns/sales',
    permission: 'sale:read',
    dated: false,
    render: (data) => {
      const total = data.returns.reduce((sum, row) => sum + row.totalPaise, 0);
      if (!data.returns.length) return <Empty icon="↩️" title="No returns" hint="No customer has returned anything." />;
      return (
        <>
          <div className="stat-grid">
            <StatTile label="Returned" value={money(total)} note={`${data.returns.length} returns`} accent />
            <StatTile label="Refunded" value={money(data.returns.reduce((sum, row) => sum + row.refundPaise, 0))} />
          </div>
          <div className="list">
            {data.returns.slice(0, MAX_ROWS).map((row) => (
              <ListRow
                key={row.id}
                title={`${row.returnNumber} · ${row.customer?.name ?? 'Walk-in'}`}
                subtitle={`${dateLabel(row.createdAt)} · ${row.reason}`}
                amount={money(row.totalPaise)}
                note={`${row.items.length} ${row.items.length === 1 ? 'item' : 'items'}`}
              />
            ))}
          </div>
          <TrimNote shown={Math.min(MAX_ROWS, data.returns.length)} total={data.returns.length} />
        </>
      );
    },
    copyText: (data) =>
      [
        figure('Returns', String(data.returns.length)),
        figure('Value', money(data.returns.reduce((sum, row) => sum + row.totalPaise, 0))),
        '',
        ...data.returns
          .slice(0, MAX_ROWS)
          .map((row) => `${row.returnNumber} ${row.customer?.name ?? 'Walk-in'}: ${money(row.totalPaise)}`),
      ].join('\n'),
  }),

  'purchase-returns': defineReport<PurchaseReturnsReport>({
    title: 'Purchase Returns',
    description: 'Goods you sent back to suppliers',
    endpoint: '/returns/purchases',
    permission: 'purchase:read',
    dated: false,
    render: (data) => {
      const total = data.returns.reduce((sum, row) => sum + row.totalPaise, 0);
      if (!data.returns.length) return <Empty icon="↪️" title="No returns" hint="Nothing has gone back to a supplier." />;
      return (
        <>
          <div className="stat-grid">
            <StatTile label="Sent back" value={money(total)} note={`${data.returns.length} returns`} accent />
            <StatTile label="Suppliers" value={String(new Set(data.returns.map((row) => row.supplier?.name)).size)} />
          </div>
          <div className="list">
            {data.returns.slice(0, MAX_ROWS).map((row) => (
              <ListRow
                key={row.id}
                title={`${row.returnNumber} · ${row.supplier?.name ?? 'Unknown supplier'}`}
                subtitle={`${dateLabel(row.createdAt)} · ${row.reason}`}
                amount={money(row.totalPaise)}
                note={row.settlement === 'CASH_REFUND' ? 'cash back' : 'off the due'}
              />
            ))}
          </div>
          <TrimNote shown={Math.min(MAX_ROWS, data.returns.length)} total={data.returns.length} />
        </>
      );
    },
    copyText: (data) =>
      [
        figure('Returns', String(data.returns.length)),
        figure('Value', money(data.returns.reduce((sum, row) => sum + row.totalPaise, 0))),
        '',
        ...data.returns
          .slice(0, MAX_ROWS)
          .map((row) => `${row.returnNumber} ${row.supplier?.name ?? 'Unknown supplier'}: ${money(row.totalPaise)}`),
      ].join('\n'),
  }),

  'stock-movement': defineReport<StockMovementReport>({
    title: 'Stock Movement',
    description: 'Every piece that came in or went out',
    endpoint: '/reports/stock-movement',
    defaultRange: 'THIS_WEEK',
    render: (data) => {
      const types = Object.entries(data.byType).filter(([, quantity]) => quantity !== 0);
      return (
        <>
          {types.length ? (
            <Card title="By reason">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Reason</th>
                    <th className="num">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {types.map(([type, quantity]) => (
                    <tr key={type}>
                      <td>{MOVEMENT_LABEL[type] ?? type}</td>
                      <td className="num">
                        {quantity > 0 ? '+' : ''}
                        {qtyLabel(quantity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}

          {data.transactions.length ? (
            <Card title="Newest first">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Reason</th>
                    <th className="num">Change</th>
                    <th className="num">Left</th>
                  </tr>
                </thead>
                <tbody>
                  {data.transactions.slice(0, MAX_ROWS).map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        {entry.product}
                        <div className="muted">{dateLabel(entry.date)}</div>
                      </td>
                      <td>{MOVEMENT_LABEL[entry.type] ?? entry.type}</td>
                      <td className="num">
                        {entry.quantity > 0 ? '+' : ''}
                        {qtyLabel(entry.quantity)}
                      </td>
                      <td className="num">{qtyLabel(entry.newStock)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TrimNote shown={Math.min(MAX_ROWS, data.transactions.length)} total={data.transactions.length} />
            </Card>
          ) : (
            <Empty icon="📦" title="No movement" hint="No stock came in or went out in this period." />
          )}
        </>
      );
    },
    copyText: (data) =>
      Object.entries(data.byType)
        .map(([type, quantity]) => figure(MOVEMENT_LABEL[type] ?? type, qtyLabel(quantity)))
        .join('\n'),
  }),

  scans: defineReport<ScanReport>({
    title: 'Scan History',
    description: 'Every photo the app read, and what was confirmed',
    endpoint: '/reports/scans',
    defaultRange: 'THIS_MONTH',
    render: (data, context) => (
      <>
        <div className="stat-grid">
          <StatTile label="Scans" value={String(data.totals.total)} accent />
          <StatTile label="Needs review" value={String(data.totals.pending)} note="Waiting for you" />
          <StatTile label="Confirmed" value={String(data.totals.approved)} />
          <StatTile label="Not used" value={String(data.totals.rejected + data.totals.failed)} note="Cancelled or unreadable" />
        </div>

        {data.scans.length ? (
          <div className="list">
            {data.scans.map((scan) => {
              const badge = SCAN_STATUS[scan.status] ?? { tone: 'grey' as const, label: scan.status };
              return (
                <ListRow
                  key={scan.id}
                  title={`${SCAN_TYPE_LABEL[scan.type] ?? scan.type} · ${scan.supplier ?? 'No supplier read'}`}
                  subtitle={
                    <>
                      {scan.itemCount} {scan.itemCount === 1 ? 'line' : 'lines'} read · {percent(scan.confidence)} sure
                      <br />
                      {dateTimeLabel(scan.createdAt)}
                      {scan.approvedAt ? ` · confirmed ${dateTimeLabel(scan.approvedAt)}` : ''}
                      {scan.resultRefType ? ` · ${SCAN_RESULT_LABEL[scan.resultRefType] ?? scan.resultRefType}` : ''}
                    </>
                  }
                  right={<Badge tone={badge.tone}>{badge.label}</Badge>}
                  onClick={() => context.navigate(`/scanner/${scan.id}`)}
                />
              );
            })}
          </div>
        ) : (
          <Empty icon="📷" title="No scans" hint="Photograph a supplier invoice and the app will read it for you." />
        )}

        <p className="muted">
          Open a scan to see every line the app read, what you changed and who confirmed it.
        </p>
      </>
    ),
    copyText: (data) =>
      [
        figure('Scans', String(data.totals.total)),
        figure('Confirmed', String(data.totals.approved)),
        figure('Needs review', String(data.totals.pending)),
        figure('Cancelled or unreadable', String(data.totals.rejected + data.totals.failed)),
        '',
        ...data.scans
          .slice(0, MAX_ROWS)
          .map(
            (scan) =>
              `${dateLabel(scan.createdAt)} ${SCAN_TYPE_LABEL[scan.type] ?? scan.type}: ${scan.itemCount} lines, ${percent(
                scan.confidence,
              )} sure, ${SCAN_STATUS[scan.status]?.label ?? scan.status}`,
          ),
      ].join('\n'),
  }),
};

/* ---------- The screen ---------- */

/** One report at a time, with the date window on top and a share button below. */
export function ReportView() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const business = useSession((state) => state.business);
  const settings = useSession((state) => state.settings);
  const spec = REPORTS[key];
  const [range, setRange] = useState<RangeKey>(spec?.defaultRange ?? 'TODAY');

  const allowed = Boolean(spec) && can(spec.permission);

  const report = useAsync<unknown>(
    () =>
      spec && allowed
        ? api.get<unknown>(spec.endpoint, { ...spec.query, ...(spec.dated ? { preset: range } : {}) })
        : Promise.resolve(null),
    [key, range, allowed],
  );

  const rangeLabel = RANGE_OPTIONS.find((option) => option.value === range)?.label ?? '';

  if (!spec) {
    return (
      <>
        <TopBar title="Report" back />
        <Screen>
          <Empty
            icon="📊"
            title="This report is not available"
            hint="Pick one from the list."
            action={
              <button type="button" className="btn" onClick={() => navigate('/reports')}>
                All Reports
              </button>
            }
          />
        </Screen>
      </>
    );
  }

  const copy = async () => {
    if (!report.data) return;
    const header = [business?.name, spec.title, spec.dated ? rangeLabel : dateLabel(new Date())]
      .filter(Boolean)
      .join('\n');
    const text = `${header}\n\n${spec.copyText(report.data)}`.trim();
    try {
      if (!navigator.clipboard?.writeText) throw new Error('No clipboard on this phone');
      await navigator.clipboard.writeText(text);
      toast.success('Report copied. Paste it in WhatsApp.');
    } catch {
      toast.warning('This phone did not allow copying. Take a screenshot instead.');
    }
  };

  return (
    <>
      <TopBar title={spec.title} back subtitle={spec.dated ? rangeLabel : 'Right now'} />
      <Screen>
        {spec.dated ? <ChipRow value={range} onChange={setRange} options={RANGE_OPTIONS} /> : null}
        <p className="muted">{spec.description}</p>

        {!allowed ? <Empty icon="🔒" title="Not open for you" hint="Ask the owner for report access." /> : null}

        <ErrorNotice error={report.error} onRetry={report.reload} />
        {report.loading ? <Loading label="Adding up…" /> : null}

        {report.data
          ? spec.render(report.data, { navigate, taxLabel: settings?.taxLabel || 'Tax' })
          : null}

        {report.data ? (
          <button type="button" className="btn btn-secondary btn-block" onClick={() => void copy()}>
            Copy for WhatsApp
          </button>
        ) : null}
      </Screen>
    </>
  );
}
