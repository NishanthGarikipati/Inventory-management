import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '../../components/AppShell';
import {
  Badge,
  Banner,
  Card,
  ChipRow,
  ErrorNotice,
  Loading,
  MoneyField,
  Screen,
  Sheet,
  StatTile,
  TextAreaField,
} from '../../components/ui';
import { PartyFields, partyBody, partyValuesOf, type PartyValues } from './PartyForm';
import { useAsync, useSubmit } from '../../hooks/useAsync';
import { api, newRequestId } from '../../lib/api';
import { dateLabel, dateTimeLabel, money } from '../../lib/format';
import { toast } from '../../lib/toast';
import { PAYMENT_METHODS } from '../../store/cart';
import { useSession } from '../../store/session';
import type { PaymentMethod } from '../../lib/types';

interface SupplierPurchase {
  id: string;
  invoiceNumber: string | null;
  purchaseDate: string;
  totalPaise: number;
  duePaise: number;
  status: string;
}

interface SupplierPaymentRow {
  id: string;
  amountPaise: number;
  method: string;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

interface SupplierReturnRow {
  id: string;
  returnNumber: string;
  reason: string;
  totalPaise: number;
  settlement: string;
  createdAt: string;
}

interface SupplierDetailResponse {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  balancePaise: number;
  purchases: SupplierPurchase[];
  payments: SupplierPaymentRow[];
  purchaseReturns: SupplierReturnRow[];
  summary: {
    purchaseCount: number;
    totalPurchasedPaise: number;
    totalPaidPaise: number;
    outstandingPaise: number;
  };
}

/** One supplier's page: what you bought, what you paid, what you still owe. */
export function SupplierDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const [payOpen, setPayOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const supplier = useAsync(() => api.get<SupplierDetailResponse>(`/suppliers/${id}`), [id]);
  const data = supplier.data;

  return (
    <>
      <TopBar title={data?.name ?? 'Supplier'} back subtitle={data?.phone ?? undefined} />
      <Screen>
        <ErrorNotice error={supplier.error} onRetry={supplier.reload} />
        {supplier.loading && !data ? <Loading /> : null}

        {data ? (
          <>
            <div className="stat-grid">
              <StatTile label="You Owe" value={money(data.summary.outstandingPaise)} note="To pay" accent />
              <StatTile
                label="Total Bought"
                value={money(data.summary.totalPurchasedPaise)}
                note={`${data.summary.purchaseCount} ${data.summary.purchaseCount === 1 ? 'purchase' : 'purchases'}`}
              />
              <StatTile label="Paid" value={money(data.summary.totalPaidPaise)} note="Paid so far" />
            </div>

            {can('payment:create') ? (
              <button type="button" className="btn btn-block btn-lg" onClick={() => setPayOpen(true)}>
                Pay Supplier
              </button>
            ) : null}

            <div className="row">
              {can('purchase:write') ? (
                <button type="button" className="btn btn-secondary grow" onClick={() => navigate('/purchases/new')}>
                  New Purchase
                </button>
              ) : null}
              {can('supplier:write') ? (
                <button type="button" className="btn btn-secondary grow" onClick={() => setEditOpen(true)}>
                  Edit
                </button>
              ) : null}
            </div>

            <Card title="Details">
              <div className="row-between">
                <span>Phone</span>
                <strong>{data.phone ?? '—'}</strong>
              </div>
              <div className="row-between" style={{ marginTop: 6 }}>
                <span>Address</span>
                <strong className="text-right">{data.address ?? '—'}</strong>
              </div>
              <div className="row-between" style={{ marginTop: 6 }}>
                <span>GSTIN</span>
                <strong>{data.gstin ?? '—'}</strong>
              </div>
            </Card>

            <Card title="Purchases" flush>
              <div className="list">
                {data.purchases.map((purchase) => (
                  <button
                    key={purchase.id}
                    type="button"
                    className="list-item"
                    onClick={() => navigate(`/purchases/${purchase.id}`)}
                  >
                    <div className="li-main">
                      <div className="li-title">
                        {purchase.invoiceNumber ?? 'No invoice number'}{' '}
                        {purchase.status === 'CANCELLED' ? <Badge tone="red">Cancelled</Badge> : null}
                      </div>
                      <div className="li-sub">{dateLabel(purchase.purchaseDate)}</div>
                    </div>
                    <div className="li-right">
                      <div className="li-amount">{money(purchase.totalPaise)}</div>
                      {purchase.duePaise > 0 ? <div className="li-sub">{money(purchase.duePaise)} to pay</div> : null}
                    </div>
                  </button>
                ))}
                {!data.purchases.length ? (
                  <div style={{ padding: 16 }} className="muted">
                    Nothing bought from them yet.
                  </div>
                ) : null}
              </div>
            </Card>

            <Card title="Payments paid" flush>
              <div className="list">
                {data.payments.map((payment) => (
                  <div className="list-item" key={payment.id}>
                    <div className="avatar">💸</div>
                    <div className="li-main">
                      <div className="li-title">{methodLabel(payment.method)}</div>
                      <div className="li-sub">
                        {dateTimeLabel(payment.createdAt)}
                        {payment.note ? ` · ${payment.note}` : ''}
                      </div>
                    </div>
                    <div className="li-right">
                      <div className="li-amount">{money(payment.amountPaise)}</div>
                    </div>
                  </div>
                ))}
                {!data.payments.length ? (
                  <div style={{ padding: 16 }} className="muted">
                    Nothing paid yet.
                  </div>
                ) : null}
              </div>
            </Card>

            {data.purchaseReturns.length ? (
              <Card title="Goods returned to them" flush>
                <div className="list">
                  {data.purchaseReturns.map((entry) => (
                    <div className="list-item" key={entry.id}>
                      <div className="avatar">↩️</div>
                      <div className="li-main">
                        <div className="li-title">{entry.returnNumber}</div>
                        <div className="li-sub">
                          {dateLabel(entry.createdAt)} · {entry.reason}
                        </div>
                      </div>
                      <div className="li-right">
                        <div className="li-amount">{money(entry.totalPaise)}</div>
                        <div className="li-sub">
                          {entry.settlement === 'CASH_REFUND' ? 'money back' : 'cut from due'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}

            {can('purchase:return') ? (
              <button
                type="button"
                className="btn btn-secondary btn-block"
                onClick={() => navigate(`/returns/purchases/new?supplierId=${data.id}`)}
              >
                Return Goods To Supplier
              </button>
            ) : null}
          </>
        ) : null}
      </Screen>

      {data ? (
        <>
          <PaySupplierSheet
            open={payOpen}
            supplier={data}
            onClose={() => setPayOpen(false)}
            onDone={() => {
              setPayOpen(false);
              supplier.reload();
            }}
          />
          <EditSupplierSheet
            open={editOpen}
            supplier={data}
            onClose={() => setEditOpen(false)}
            onSaved={() => {
              setEditOpen(false);
              supplier.reload();
            }}
          />
        </>
      ) : null}
    </>
  );
}

const METHOD_OPTIONS = PAYMENT_METHODS.filter((entry) => entry.code !== 'CREDIT').map((entry) => ({
  value: entry.code,
  label: `${entry.icon} ${entry.label}`,
}));

const methodLabel = (method: string): string =>
  PAYMENT_METHODS.find((entry) => entry.code === method)?.label ?? method;

function PaySupplierSheet({
  open,
  supplier,
  onClose,
  onDone,
}: {
  open: boolean;
  supplier: SupplierDetailResponse;
  onClose: () => void;
  onDone: () => void;
}) {
  const sync = useSession((state) => state.sync);
  const [amountPaise, setAmountPaise] = useState(Math.max(0, supplier.summary.outstandingPaise));
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setAmountPaise(Math.max(0, supplier.summary.outstandingPaise));
    setMethod('CASH');
    setNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pay = useSubmit(async () => {
    const clientRequestId = newRequestId();
    const payment = await api.post<{ settledPurchases: string[] }>(
      '/payments/supplier',
      { supplierId: supplier.id, amountPaise, method, note: note.trim() || undefined, clientRequestId },
      clientRequestId,
    );
    toast.success(
      payment.settledPurchases.length
        ? `${money(amountPaise)} paid. ${payment.settledPurchases.length} ${
            payment.settledPurchases.length === 1 ? 'invoice' : 'invoices'
          } settled.`
        : `${money(amountPaise)} paid.`,
    );
    void sync();
    onDone();
  });

  const remaining = supplier.summary.outstandingPaise - amountPaise;

  return (
    <Sheet open={open} title={`Pay ${supplier.name}`} onClose={onClose}>
      <div className="stack">
        <MoneyField label="Amount paid" valuePaise={amountPaise} onChange={setAmountPaise} autoFocus />
        {supplier.summary.outstandingPaise > 0 ? (
          <div className="chip-row">
            <button type="button" className="chip" onClick={() => setAmountPaise(supplier.summary.outstandingPaise)}>
              Full {money(supplier.summary.outstandingPaise)}
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => setAmountPaise(Math.round(supplier.summary.outstandingPaise / 2))}
            >
              Half
            </button>
          </div>
        ) : null}

        <ChipRow value={method} onChange={setMethod} options={METHOD_OPTIONS} />
        <TextAreaField label="Note (optional)" value={note} onChange={setNote} placeholder="Paid by UPI to Sharma ji" />

        <Banner tone="info" icon="📒">
          This money clears the oldest invoices first.
          {remaining > 0 ? ` ${money(remaining)} will still be to pay.` : ' Nothing will be left to pay.'}
        </Banner>

        <ErrorNotice error={pay.error} />

        <button
          type="button"
          className="btn btn-block btn-lg"
          disabled={pay.busy || amountPaise <= 0}
          onClick={() => void pay.run()}
        >
          {pay.busy ? 'Saving…' : `Pay ${money(amountPaise)}`}
        </button>
      </div>
    </Sheet>
  );
}

function EditSupplierSheet({
  open,
  supplier,
  onClose,
  onSaved,
}: {
  open: boolean;
  supplier: SupplierDetailResponse;
  onClose: () => void;
  onSaved: () => void;
}) {
  const sync = useSession((state) => state.sync);
  const [values, setValues] = useState<PartyValues>(() => partyValuesOf(supplier));

  useEffect(() => {
    if (open) setValues(partyValuesOf(supplier));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = useSubmit(async () => {
    await api.put(`/suppliers/${supplier.id}`, partyBody('SUPPLIER', values));
    toast.success('Supplier details saved.');
    void sync();
    onSaved();
  });

  return (
    <Sheet open={open} title="Edit supplier" onClose={onClose}>
      <div className="stack">
        <PartyFields kind="SUPPLIER" values={values} onChange={setValues} />
        <p className="muted">What you owe is changed by purchases and payments, not here.</p>
        <ErrorNotice error={save.error} />
        <button
          type="button"
          className="btn btn-block btn-lg"
          disabled={save.busy || values.name.trim().length < 2}
          onClick={() => void save.run()}
        >
          {save.busy ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </Sheet>
  );
}
