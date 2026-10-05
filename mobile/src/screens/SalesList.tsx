import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../components/AppShell';
import { Badge, ChipRow, Empty, ErrorNotice, Loading, Screen, StatTile } from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { dateTimeLabel, money } from '../lib/format';
import { rangeFor, type RangeKey, RANGE_OPTIONS } from '../lib/ranges';

interface SaleRow {
  id: string;
  invoiceNumber: string;
  saleDate: string;
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
  status: string;
  customer: { id: string; name: string } | null;
  _count: { items: number };
}

export function SalesList() {
  const navigate = useNavigate();
  const [range, setRange] = useState<RangeKey>('TODAY');
  const { from, to } = rangeFor(range);

  const sales = useAsync(
    () => api.get<{ items: SaleRow[]; total: number }>('/sales', { from, to, pageSize: 100 }),
    [from, to],
  );

  const rows = sales.data?.items ?? [];
  const total = rows.filter((row) => row.status === 'COMPLETED').reduce((sum, row) => sum + row.totalPaise, 0);

  return (
    <>
      <TopBar title="Bills" back subtitle={`${rows.length} bills`} />
      <Screen>
        <ChipRow value={range} onChange={setRange} options={RANGE_OPTIONS} />
        <div className="stat-grid">
          <StatTile label="Total" value={money(total)} note={`${rows.length} bills`} accent />
          <StatTile
            label="Unpaid"
            value={money(rows.reduce((sum, row) => sum + row.duePaise, 0))}
            note="Given on credit"
          />
        </div>

        <ErrorNotice error={sales.error} onRetry={sales.reload} />
        {sales.loading ? <Loading /> : null}
        {!sales.loading && !rows.length ? <Empty icon="🧾" title="No bills yet" hint="Bills you make will appear here." /> : null}

        {rows.length ? (
          <div className="list">
            {rows.map((sale) => (
              <button key={sale.id} type="button" className="list-item" onClick={() => navigate(`/sales/${sale.id}`)}>
                <div className="li-main">
                  <div className="li-title">
                    {sale.invoiceNumber}
                    {sale.status === 'CANCELLED' ? ' · ' : ''}
                    {sale.status === 'CANCELLED' ? <Badge tone="red">Cancelled</Badge> : null}
                  </div>
                  <div className="li-sub">
                    {dateTimeLabel(sale.saleDate)} · {sale.customer?.name ?? 'Walk-in'} · {sale._count.items} items
                  </div>
                </div>
                <div className="li-right">
                  <div className="li-amount">{money(sale.totalPaise)}</div>
                  {sale.duePaise > 0 ? <div className="li-sub">{money(sale.duePaise)} due</div> : null}
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </Screen>
    </>
  );
}
