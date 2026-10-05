import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '../components/AppShell';
import {
  Badge,
  Banner,
  Card,
  ErrorNotice,
  Loading,
  Screen,
  Sheet,
  TextField,
  TotalsRow,
} from '../components/ui';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { api } from '../lib/api';
import { dateTimeLabel, money, quantity as qtyLabel } from '../lib/format';
import { toast } from '../lib/toast';
import { useSession } from '../store/session';

interface SaleItem {
  id: string;
  productName: string;
  quantity: number;
  unitPricePaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
}

interface SaleDetailResponse {
  id: string;
  invoiceNumber: string;
  saleDate: string;
  status: string;
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
  grossProfitPaise: number;
  note: string | null;
  items: SaleItem[];
  payments: Array<{ id: string; method: string; amountPaise: number }>;
  customer: { id: string; name: string; phone: string | null } | null;
  user: { id: string; name: string } | null;
}

export function SaleDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const settings = useSession((state) => state.settings);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  const sale = useAsync(() => api.get<SaleDetailResponse>(`/sales/${id}`), [id]);
  const data = sale.data;

  const cancel = useSubmit(async () => {
    await api.post(`/sales/${id}/cancel`, { reason });
    toast.success('Bill cancelled and stock returned.');
    setCancelOpen(false);
    sale.reload();
  });

  return (
    <>
      <TopBar title={data?.invoiceNumber ?? 'Bill'} back subtitle={data ? dateTimeLabel(data.saleDate) : undefined} />
      <Screen>
        <ErrorNotice error={sale.error} onRetry={sale.reload} />
        {sale.loading && !data ? <Loading /> : null}

        {data ? (
          <>
            {data.status === 'CANCELLED' ? (
              <Banner tone="danger" icon="🚫">
                This bill was cancelled. The stock went back to the shelf.
              </Banner>
            ) : null}

            <Card title="Items" flush>
              <div className="list">
                {data.items.map((item) => (
                  <div className="list-item" key={item.id}>
                    <div className="li-main">
                      <div className="li-title">{item.productName}</div>
                      <div className="li-sub">
                        {qtyLabel(item.quantity)} × {money(item.unitPricePaise)}
                        {item.discountPaise > 0 ? ` − ${money(item.discountPaise)}` : ''}
                      </div>
                    </div>
                    <div className="li-right">
                      <div className="li-amount">{money(item.totalPaise)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <TotalsRow label="Subtotal" value={money(data.subtotalPaise)} />
              {data.discountPaise > 0 ? <TotalsRow label="Discount" value={`− ${money(data.discountPaise)}`} /> : null}
              {data.taxPaise > 0 ? <TotalsRow label={settings?.taxLabel || 'Tax'} value={money(data.taxPaise)} /> : null}
              {data.roundOffPaise !== 0 ? <TotalsRow label="Round off" value={money(data.roundOffPaise)} /> : null}
              <TotalsRow label="Total" value={money(data.totalPaise)} grand />
              <TotalsRow label="Paid" value={money(data.paidPaise)} />
              {data.duePaise > 0 ? <TotalsRow label="On credit" value={money(data.duePaise)} /> : null}
            </Card>

            <Card title="Payment">
              {data.payments.length ? (
                data.payments.map((payment) => (
                  <div className="row-between" key={payment.id} style={{ padding: '6px 0' }}>
                    <span>{payment.method}</span>
                    <strong>{money(payment.amountPaise)}</strong>
                  </div>
                ))
              ) : (
                <p className="muted">Fully on credit.</p>
              )}
              <div className="row-between" style={{ marginTop: 10 }}>
                <span>Customer</span>
                {data.customer ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/customers/${data.customer!.id}`)}>
                    {data.customer.name}
                  </button>
                ) : (
                  <strong>Walk-in</strong>
                )}
              </div>
              <div className="row-between">
                <span>Billed by</span>
                <strong>{data.user?.name ?? 'Unknown'}</strong>
              </div>
            </Card>

            {can('report:read') ? (
              <Card title="Profit on this bill">
                <div className="row-between">
                  <span>Estimated gross profit</span>
                  <Badge tone={data.grossProfitPaise >= 0 ? 'green' : 'red'}>{money(data.grossProfitPaise)}</Badge>
                </div>
                <p className="muted" style={{ marginTop: 8 }}>
                  Sales value minus what the goods cost. Shop expenses are not included.
                </p>
              </Card>
            ) : null}

            {data.status === 'COMPLETED' ? (
              <div className="row">
                {can('sale:return') ? (
                  <button
                    type="button"
                    className="btn btn-secondary grow"
                    onClick={() => navigate(`/returns/sales/new?saleId=${data.id}`)}
                  >
                    Return Items
                  </button>
                ) : null}
                {can('sale:cancel') ? (
                  <button type="button" className="btn btn-danger grow" onClick={() => setCancelOpen(true)}>
                    Cancel Bill
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </Screen>

      <Sheet open={cancelOpen} title="Cancel this bill?" onClose={() => setCancelOpen(false)}>
        <div className="stack">
          <p>The stock goes back to the shelf and the customer's account is reversed. This cannot be undone.</p>
          <TextField label="Reason" value={reason} onChange={setReason} placeholder="Wrong bill, customer returned…" />
          <ErrorNotice error={cancel.error} />
          <button
            type="button"
            className="btn btn-danger btn-block btn-lg"
            disabled={cancel.busy || reason.trim().length < 2}
            onClick={() => void cancel.run()}
          >
            {cancel.busy ? 'Cancelling…' : 'Cancel Bill'}
          </button>
          <button type="button" className="btn btn-secondary btn-block" onClick={() => setCancelOpen(false)}>
            Keep Bill
          </button>
        </div>
      </Sheet>
    </>
  );
}
