import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TopBar } from '../components/AppShell';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { Badge, ChipRow, Empty, ErrorNotice, Loading, Screen, StatTile } from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { money, moneyShort, quantity as qtyLabel } from '../lib/format';
import { toast } from '../lib/toast';
import type { InventoryRow, StockStatus } from '../lib/types';

interface InventoryResponse {
  items: InventoryRow[];
  total: number;
  summary: { stockValuePaise: number; lowStock: number; outOfStock: number; expiringSoon: number };
}

const STATUS_FILTERS: Array<{ value: StockStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'LOW_STOCK', label: 'Low' },
  { value: 'OUT_OF_STOCK', label: 'Out' },
  { value: 'EXPIRING_SOON', label: 'Expiring' },
  { value: 'IN_STOCK', label: 'In stock' },
];

export const statusBadge = (status: StockStatus) => {
  if (status === 'OUT_OF_STOCK') return <Badge tone="red">Out of stock</Badge>;
  if (status === 'LOW_STOCK') return <Badge tone="amber">Low stock</Badge>;
  if (status === 'EXPIRING_SOON') return <Badge tone="blue">Expiring soon</Badge>;
  return <Badge tone="green">In stock</Badge>;
};

/** What is on the shelf right now, and what needs doing about it. */
export function Stock() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') as StockStatus | null) ?? 'ALL';
  const [search, setSearch] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);

  const inventory = useAsync(
    () =>
      api.get<InventoryResponse>('/inventory', {
        search: search.trim() || undefined,
        status: status === 'ALL' ? undefined : status,
        pageSize: 200,
      }),
    [search, status],
  );

  const onBarcode = async (code: string) => {
    setScannerOpen(false);
    try {
      const found = await api.get<{ product: { variantId: string } }>(`/products/barcode/${encodeURIComponent(code)}`);
      navigate(`/stock/${found.product.variantId}`);
    } catch {
      toast.warning('This barcode is not in your shop yet.');
      setSearch(code);
    }
  };

  const summary = inventory.data?.summary;

  return (
    <>
      <TopBar
        title="Stock"
        subtitle={summary ? `${moneyShort(summary.stockValuePaise)} of stock` : undefined}
        actions={
          <button type="button" className="icon-button" aria-label="Scan barcode" onClick={() => setScannerOpen(true)}>
            📷
          </button>
        }
      />

      <div className="pos-search">
        <input
          className="input"
          placeholder="Search product, SKU or barcode"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <Screen>
        <ChipRow
          value={status}
          onChange={(value) => setParams(value === 'ALL' ? {} : { status: value }, { replace: true })}
          options={STATUS_FILTERS}
        />

        {summary ? (
          <div className="stat-grid">
            <StatTile label="Stock Value" value={moneyShort(summary.stockValuePaise)} note="At cost" />
            <StatTile label="Low / Out" value={`${summary.lowStock} / ${summary.outOfStock}`} note="Needs buying" />
          </div>
        ) : null}

        <ErrorNotice error={inventory.error} onRetry={inventory.reload} />
        {inventory.loading && !inventory.data ? <Loading /> : null}

        {inventory.data && !inventory.data.items.length ? (
          <Empty icon="📦" title="Nothing here" hint="Try another filter or search." />
        ) : null}

        {inventory.data?.items.length ? (
          <div className="list">
            {inventory.data.items.map((row) => (
              <button key={row.variantId} type="button" className="list-item" onClick={() => navigate(`/stock/${row.variantId}`)}>
                <div className="li-main">
                  <div className="li-title">{row.name}</div>
                  <div className="li-sub">
                    {row.category ?? 'Uncategorised'} · {money(row.sellingPricePaise)}
                  </div>
                </div>
                <div className="li-right">
                  <div className="li-amount">
                    {qtyLabel(row.quantity)} <span className="muted">{row.unit.toLowerCase()}</span>
                  </div>
                  <div className="li-sub">{statusBadge(row.status)}</div>
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </Screen>

      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={(code) => void onBarcode(code)} />
    </>
  );
}
