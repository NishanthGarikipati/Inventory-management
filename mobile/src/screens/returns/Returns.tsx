import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../../components/AppShell';
import { Badge, ChipRow, Empty, ErrorNotice, Loading, Screen } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { dateLabel, money, quantity as qtyLabel } from '../../lib/format';
import { useSession } from '../../store/session';

interface ReturnLine {
  id: string;
  quantity: number;
  totalPaise: number;
}

interface SalesReturnRow {
  id: string;
  returnNumber: string;
  reason: string;
  totalPaise: number;
  refundPaise: number;
  refundMethod: string;
  createdAt: string;
  items: ReturnLine[];
  customer: { id: string; name: string } | null;
  sale: { invoiceNumber: string } | null;
}

interface PurchaseReturnRow {
  id: string;
  returnNumber: string;
  reason: string;
  totalPaise: number;
  settlement: string;
  createdAt: string;
  items: ReturnLine[];
  supplier: { id: string; name: string } | null;
}

type Tab = 'CUSTOMER' | 'SUPPLIER';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'CUSTOMER', label: 'From customers' },
  { value: 'SUPPLIER', label: 'To suppliers' },
];

const REFUND_LABEL: Record<string, string> = {
  CASH: 'Cash back',
  UPI: 'UPI back',
  CARD: 'Card back',
  CREDIT_NOTE: 'Credit note',
  ADJUST_DUE: 'Taken off dues',
};

const SETTLEMENT_LABEL: Record<string, string> = {
  ADJUST_DUE: 'Taken off what we owe',
  CASH_REFUND: 'Cash back from supplier',
};

function itemCountLabel(items: ReturnLine[]): string {
  const total = Number(items.reduce((sum, item) => sum + item.quantity, 0).toFixed(3));
  return `${qtyLabel(total)} ${total === 1 ? 'item' : 'items'}`;
}

/** Goods coming back: from customers to the shop, or from the shop to suppliers. */
export function Returns() {
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const [tab, setTab] = useState<Tab>('CUSTOMER');

  const returns = useAsync(async () => {
    if (tab === 'CUSTOMER') {
      const response = await api.get<{ returns: SalesReturnRow[] }>('/returns/sales');
      return { tab, sales: response.returns, purchases: [] as PurchaseReturnRow[] };
    }
    const response = await api.get<{ returns: PurchaseReturnRow[] }>('/returns/purchases');
    return { tab, sales: [] as SalesReturnRow[], purchases: response.returns };
  }, [tab]);

  const loaded = returns.data?.tab === tab ? returns.data : null;
  const count = (loaded?.sales.length ?? 0) + (loaded?.purchases.length ?? 0);

  return (
    <>
      <TopBar title="Returns" subtitle="Goods taken back" back />
      <Screen>
        <div className="row">
          {can('sale:return') ? (
            <button type="button" className="btn grow" onClick={() => navigate('/returns/sales/new')}>
              Customer Return
            </button>
          ) : null}
          {can('purchase:return') ? (
            <button type="button" className="btn btn-secondary grow" onClick={() => navigate('/returns/purchases/new')}>
              Return to Supplier
            </button>
          ) : null}
        </div>

        <ChipRow value={tab} onChange={setTab} options={TABS} />

        <ErrorNotice error={returns.error} onRetry={returns.reload} />
        {returns.loading ? <Loading /> : null}

        {!returns.loading && loaded && !count ? (
          <Empty
            icon="↩️"
            title={tab === 'CUSTOMER' ? 'No customer returns yet' : 'Nothing sent back yet'}
            hint={
              tab === 'CUSTOMER'
                ? 'When a customer brings something back, record it here so stock and money both stay correct.'
                : 'When you send goods back to a supplier, record it here so what you owe goes down.'
            }
          />
        ) : null}

        {loaded?.sales.length ? (
          <div className="list">
            {loaded.sales.map((entry) => (
              <div className="list-item" key={entry.id}>
                <div className="li-main">
                  <div className="li-title">
                    {entry.returnNumber}{' '}
                    <Badge tone="teal">{REFUND_LABEL[entry.refundMethod] ?? entry.refundMethod}</Badge>
                  </div>
                  <div className="li-sub">
                    {dateLabel(entry.createdAt)} · {entry.customer?.name ?? 'Walk-in'} · {itemCountLabel(entry.items)}
                  </div>
                  <div className="li-sub">
                    {entry.sale ? `${entry.sale.invoiceNumber} · ` : ''}
                    {entry.reason}
                  </div>
                </div>
                <div className="li-right">
                  <div className="li-amount">{money(entry.totalPaise)}</div>
                  <div className="li-sub">
                    {entry.refundPaise > 0 ? `${money(entry.refundPaise)} given back` : 'No cash given'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {loaded?.purchases.length ? (
          <div className="list">
            {loaded.purchases.map((entry) => (
              <div className="list-item" key={entry.id}>
                <div className="li-main">
                  <div className="li-title">{entry.returnNumber}</div>
                  <div className="li-sub">
                    {dateLabel(entry.createdAt)} · {entry.supplier?.name ?? 'No supplier'} · {itemCountLabel(entry.items)}
                  </div>
                  <div className="li-sub">{entry.reason}</div>
                </div>
                <div className="li-right">
                  <div className="li-amount">{money(entry.totalPaise)}</div>
                  <div className="li-sub">{SETTLEMENT_LABEL[entry.settlement] ?? entry.settlement}</div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Screen>
    </>
  );
}
