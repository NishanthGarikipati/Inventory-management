import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../../components/AppShell';
import { Badge, ChipRow, Empty, ErrorNotice, Loading, Screen } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { dateLabel, money } from '../../lib/format';
import { RANGE_OPTIONS, rangeFor, type RangeKey } from '../../lib/ranges';
import { useSession } from '../../store/session';

interface PurchaseRow {
  id: string;
  invoiceNumber: string | null;
  purchaseDate: string;
  status: string;
  totalPaise: number;
  duePaise: number;
  source: string;
  supplier: { id: string; name: string } | null;
  _count: { items: number };
}

interface PurchaseListResponse {
  items: PurchaseRow[];
  total: number;
}

const SOURCE_LABEL: Record<string, string> = {
  MANUAL: 'Typed in',
  IMAGE_SCAN: 'From a photo',
  BARCODE: 'Scanned',
};

/** Goods the shop bought, newest first. */
export function PurchaseList() {
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const [range, setRange] = useState<RangeKey>('THIS_MONTH');
  const { from, to, label } = rangeFor(range);

  const purchases = useAsync(
    () => api.get<PurchaseListResponse>('/purchases', { from, to, pageSize: 100 }),
    [from, to],
  );
  const items = purchases.data?.items ?? [];

  return (
    <>
      <TopBar
        title="Purchases"
        subtitle={label}
        back
        actions={
          can('purchase:write') ? (
            <button type="button" className="icon-button" aria-label="New purchase" onClick={() => navigate('/purchases/new')}>
              ➕
            </button>
          ) : null
        }
      />
      <Screen>
        <ChipRow value={range} onChange={setRange} options={RANGE_OPTIONS} />

        {can('purchase:write') ? (
          <div className="quick-actions">
            <button type="button" className="quick-action primary" onClick={() => navigate('/purchases/new')}>
              <span className="qa-icon">📥</span>
              <span className="qa-label">NEW PURCHASE</span>
            </button>
            {can('scanner:use') ? (
              <button type="button" className="quick-action" onClick={() => navigate('/scanner')}>
                <span className="qa-icon">📷</span>
                <span className="qa-label">SCAN INVOICE</span>
              </button>
            ) : null}
          </div>
        ) : null}

        <ErrorNotice error={purchases.error} onRetry={purchases.reload} />
        {purchases.loading && !purchases.data ? <Loading label="Loading purchases…" /> : null}

        {!purchases.loading && !items.length ? (
          <Empty
            icon="📥"
            title="No purchases in this period"
            hint="Record a purchase, or photograph a supplier invoice and confirm it."
          />
        ) : null}

        {items.length ? (
          <div className="list">
            {items.map((purchase) => (
              <button
                key={purchase.id}
                type="button"
                className="list-item"
                onClick={() => navigate(`/purchases/${purchase.id}`)}
              >
                <div className="li-main">
                  <div className="li-title">
                    {purchase.supplier?.name ?? 'No supplier'}{' '}
                    {purchase.status === 'CANCELLED' ? <Badge tone="red">Cancelled</Badge> : null}
                  </div>
                  <div className="li-sub">
                    {dateLabel(purchase.purchaseDate)}
                    {purchase.invoiceNumber ? ` · ${purchase.invoiceNumber}` : ''} · {purchase._count.items}{' '}
                    {purchase._count.items === 1 ? 'product' : 'products'}
                  </div>
                  <div className="li-sub">{SOURCE_LABEL[purchase.source] ?? purchase.source}</div>
                </div>
                <div className="li-right">
                  <div className="li-amount">{money(purchase.totalPaise)}</div>
                  <div className="li-sub">{purchase.duePaise > 0 ? `${money(purchase.duePaise)} due` : 'Paid'}</div>
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </Screen>
    </>
  );
}
