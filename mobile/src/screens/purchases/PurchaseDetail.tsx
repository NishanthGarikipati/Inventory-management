import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '../../components/AppShell';
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
} from '../../components/ui';
import { useAsync, useSubmit } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { dateLabel, dateTimeLabel, money, quantity as qtyLabel } from '../../lib/format';
import { toast } from '../../lib/toast';
import { useSession } from '../../store/session';

interface PurchaseItem {
  id: string;
  productName: string;
  quantity: number;
  returnedQty: number;
  unitCostPaise: number;
  taxPaise: number;
  totalPaise: number;
  batch: { batchNumber: string; expiryDate: string | null } | null;
}

interface PurchaseDetailResponse {
  id: string;
  invoiceNumber: string | null;
  purchaseDate: string;
  status: string;
  source: string;
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
  note: string | null;
  items: PurchaseItem[];
  payments: Array<{ id: string; method: string; amountPaise: number }>;
  supplier: { id: string; name: string; phone: string | null } | null;
}

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  CREDIT: 'On credit',
  OTHER: 'Other',
};

/** One purchase: what came in, what it cost, and what is still unpaid. */
export function PurchaseDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  const purchase = useAsync(() => api.get<PurchaseDetailResponse>(`/purchases/${id}`), [id]);
  const data = purchase.data;

  const cancel = useSubmit(async () => {
    await api.post(`/purchases/${id}/cancel`, { reason });
    toast.success('Purchase cancelled and stock reduced.');
    setCancelOpen(false);
    purchase.reload();
  });

  const title = data?.invoiceNumber || data?.supplier?.name || 'Purchase';

  return (
    <>
      <TopBar title={title} back subtitle={data ? dateTimeLabel(data.purchaseDate) : undefined} />
      <Screen>
        <ErrorNotice error={purchase.error} onRetry={purchase.reload} />
        {purchase.loading && !data ? <Loading /> : null}

        {data ? (
          <>
            {data.status === 'CANCELLED' ? (
              <Banner tone="danger" icon="🚫">
                This purchase was cancelled. The stock that came in was taken back out.
              </Banner>
            ) : null}
            {data.source === 'IMAGE_SCAN' ? (
              <Banner tone="info" icon="📷">
                This purchase came from a scanned invoice, after you confirmed it.
              </Banner>
            ) : null}

            <Card flush>
              <button
                type="button"
                className="list-item"
                onClick={() => data.supplier && navigate(`/suppliers/${data.supplier.id}`)}
              >
                <div className="avatar">🚚</div>
                <div className="li-main">
                  <div className="li-title">{data.supplier?.name ?? 'No supplier'}</div>
                  <div className="li-sub">{data.supplier?.phone ?? dateLabel(data.purchaseDate)}</div>
                </div>
              </button>
            </Card>

            <Card title="Products" flush>
              <div className="list">
                {data.items.map((item) => (
                  <div className="list-item" key={item.id}>
                    <div className="li-main">
                      <div className="li-title">{item.productName}</div>
                      <div className="li-sub">
                        {qtyLabel(item.quantity)} × {money(item.unitCostPaise)}
                        {item.batch ? ` · batch ${item.batch.batchNumber}` : ''}
                        {item.batch?.expiryDate ? ` · exp ${dateLabel(item.batch.expiryDate)}` : ''}
                      </div>
                      {item.returnedQty > 0 ? (
                        <div className="li-sub">{qtyLabel(item.returnedQty)} already sent back</div>
                      ) : null}
                    </div>
                    <div className="li-right">
                      <div className="li-amount">{money(item.totalPaise)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Amount">
              <TotalsRow label="Goods" value={money(data.subtotalPaise)} />
              {data.discountPaise > 0 ? <TotalsRow label="Discount" value={`− ${money(data.discountPaise)}`} /> : null}
              {data.taxPaise > 0 ? <TotalsRow label="Tax" value={money(data.taxPaise)} /> : null}
              <TotalsRow label="Total" value={money(data.totalPaise)} grand />
              <TotalsRow label="Paid" value={money(data.paidPaise)} />
              <TotalsRow
                label="Still due"
                value={
                  data.duePaise > 0 ? <Badge tone="amber">{money(data.duePaise)}</Badge> : <Badge tone="green">Paid</Badge>
                }
              />
              {data.payments.length ? (
                <p className="muted" style={{ marginTop: 8 }}>
                  {data.payments.map((payment) => `${METHOD_LABEL[payment.method] ?? payment.method} ${money(payment.amountPaise)}`).join(' · ')}
                </p>
              ) : null}
              {data.note ? <p style={{ marginTop: 8 }}>{data.note}</p> : null}
            </Card>

            {data.status === 'COMPLETED' ? (
              <div className="row">
                {can('purchase:return') ? (
                  <button
                    type="button"
                    className="btn btn-secondary grow"
                    onClick={() => navigate(`/returns/purchases/new?purchaseId=${data.id}`)}
                  >
                    Return to Supplier
                  </button>
                ) : null}
                {can('purchase:write') ? (
                  <button type="button" className="btn btn-danger grow" onClick={() => setCancelOpen(true)}>
                    Cancel Purchase
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </Screen>

      <Sheet open={cancelOpen} title="Cancel this purchase?" onClose={() => setCancelOpen(false)}>
        <div className="stack">
          <p>
            The stock that came in is taken back out, and anything still unpaid is removed from the supplier's account.
            If the goods have already been sold, cancel will be refused — send them back as a return instead.
          </p>
          <TextField label="Reason" value={reason} onChange={setReason} placeholder="Wrong invoice, duplicate entry…" />
          <ErrorNotice error={cancel.error} onAction={() => navigate(`/returns/purchases/new?purchaseId=${id}`)} />
          <button
            type="button"
            className="btn btn-danger btn-block btn-lg"
            disabled={cancel.busy || reason.trim().length < 2}
            onClick={() => void cancel.run()}
          >
            {cancel.busy ? 'Cancelling…' : 'Cancel Purchase'}
          </button>
          <button type="button" className="btn btn-secondary btn-block" onClick={() => setCancelOpen(false)}>
            Keep Purchase
          </button>
        </div>
      </Sheet>
    </>
  );
}
