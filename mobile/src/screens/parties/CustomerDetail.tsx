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
import { PAYMENT_METHODS, useCart } from '../../store/cart';
import { useSession } from '../../store/session';
import type { PaymentMethod } from '../../lib/types';

interface CustomerBill {
  id: string;
  invoiceNumber: string;
  saleDate: string;
  totalPaise: number;
  duePaise: number;
  status: string;
}

interface CustomerPaymentRow {
  id: string;
  amountPaise: number;
  method: string;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

interface CustomerDetailResponse {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  creditLimitPaise: number;
  balancePaise: number;
  sales: CustomerBill[];
  payments: CustomerPaymentRow[];
  summary: {
    billCount: number;
    totalPurchasedPaise: number;
    totalPaidPaise: number;
    outstandingPaise: number;
  };
}

/** One customer's page: what they bought, what they paid, what is still due. */
export function CustomerDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const cart = useCart();
  const [payOpen, setPayOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const customer = useAsync(() => api.get<CustomerDetailResponse>(`/customers/${id}`), [id]);
  const data = customer.data;

  const startBill = () => {
    if (data) cart.setCustomer(data.id, data.name);
    navigate('/sell');
  };

  return (
    <>
      <TopBar title={data?.name ?? 'Customer'} back subtitle={data?.phone ?? undefined} />
      <Screen>
        <ErrorNotice error={customer.error} onRetry={customer.reload} />
        {customer.loading && !data ? <Loading /> : null}

        {data ? (
          <>
            <div className="stat-grid">
              <StatTile label="Money Due" value={money(data.summary.outstandingPaise)} note="To collect" accent />
              <StatTile
                label="Total Bought"
                value={money(data.summary.totalPurchasedPaise)}
                note={`${data.summary.billCount} ${data.summary.billCount === 1 ? 'bill' : 'bills'}`}
              />
              <StatTile label="Paid" value={money(data.summary.totalPaidPaise)} note="Received so far" />
              <StatTile
                label="Credit Limit"
                value={data.creditLimitPaise > 0 ? money(data.creditLimitPaise) : 'No limit'}
                note={
                  data.creditLimitPaise > 0 && data.summary.outstandingPaise >= data.creditLimitPaise
                    ? 'Limit reached'
                    : undefined
                }
              />
            </div>

            {data.creditLimitPaise > 0 && data.summary.outstandingPaise >= data.creditLimitPaise ? (
              <Banner tone="warning" icon="📒">
                This customer has reached their credit limit. Take a payment before giving more credit.
              </Banner>
            ) : null}

            {can('payment:create') ? (
              <button type="button" className="btn btn-block btn-lg" onClick={() => setPayOpen(true)}>
                Take Payment
              </button>
            ) : null}

            <div className="row">
              {can('sale:create') ? (
                <button type="button" className="btn btn-secondary grow" onClick={startBill}>
                  New Bill
                </button>
              ) : null}
              {can('customer:write') ? (
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

            <Card title="Bills" flush>
              <div className="list">
                {data.sales.map((bill) => (
                  <button key={bill.id} type="button" className="list-item" onClick={() => navigate(`/sales/${bill.id}`)}>
                    <div className="li-main">
                      <div className="li-title">
                        {bill.invoiceNumber} {bill.status === 'CANCELLED' ? <Badge tone="red">Cancelled</Badge> : null}
                      </div>
                      <div className="li-sub">{dateLabel(bill.saleDate)}</div>
                    </div>
                    <div className="li-right">
                      <div className="li-amount">{money(bill.totalPaise)}</div>
                      {bill.duePaise > 0 ? <div className="li-sub">{money(bill.duePaise)} due</div> : null}
                    </div>
                  </button>
                ))}
                {!data.sales.length ? (
                  <div style={{ padding: 16 }} className="muted">
                    No bills yet.
                  </div>
                ) : null}
              </div>
            </Card>

            <Card title="Payments received" flush>
              <div className="list">
                {data.payments.map((payment) => (
                  <div className="list-item" key={payment.id}>
                    <div className="avatar">💵</div>
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
                    Nothing received yet.
                  </div>
                ) : null}
              </div>
            </Card>
          </>
        ) : null}
      </Screen>

      {data ? (
        <>
          <TakePaymentSheet
            open={payOpen}
            customer={data}
            onClose={() => setPayOpen(false)}
            onDone={() => {
              setPayOpen(false);
              customer.reload();
            }}
          />
          <EditCustomerSheet
            open={editOpen}
            customer={data}
            onClose={() => setEditOpen(false)}
            onSaved={() => {
              setEditOpen(false);
              customer.reload();
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

function TakePaymentSheet({
  open,
  customer,
  onClose,
  onDone,
}: {
  open: boolean;
  customer: CustomerDetailResponse;
  onClose: () => void;
  onDone: () => void;
}) {
  const sync = useSession((state) => state.sync);
  const [amountPaise, setAmountPaise] = useState(Math.max(0, customer.summary.outstandingPaise));
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setAmountPaise(Math.max(0, customer.summary.outstandingPaise));
    setMethod('CASH');
    setNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const take = useSubmit(async () => {
    const clientRequestId = newRequestId();
    const payment = await api.post<{ settledBills: string[] }>(
      '/payments/customer',
      { customerId: customer.id, amountPaise, method, note: note.trim() || undefined, clientRequestId },
      clientRequestId,
    );
    toast.success(
      payment.settledBills.length
        ? `${money(amountPaise)} received. ${payment.settledBills.length} ${
            payment.settledBills.length === 1 ? 'bill' : 'bills'
          } settled.`
        : `${money(amountPaise)} received.`,
    );
    void sync();
    onDone();
  });

  const remaining = customer.summary.outstandingPaise - amountPaise;

  return (
    <Sheet open={open} title={`Take payment from ${customer.name}`} onClose={onClose}>
      <div className="stack">
        <MoneyField label="Amount received" valuePaise={amountPaise} onChange={setAmountPaise} autoFocus />
        {customer.summary.outstandingPaise > 0 ? (
          <div className="chip-row">
            <button type="button" className="chip" onClick={() => setAmountPaise(customer.summary.outstandingPaise)}>
              Full {money(customer.summary.outstandingPaise)}
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => setAmountPaise(Math.round(customer.summary.outstandingPaise / 2))}
            >
              Half
            </button>
          </div>
        ) : null}

        <ChipRow value={method} onChange={setMethod} options={METHOD_OPTIONS} />
        <TextAreaField label="Note (optional)" value={note} onChange={setNote} placeholder="Paid at the shop" />

        <Banner tone="info" icon="📒">
          This money clears the oldest bills first.
          {remaining > 0 ? ` ${money(remaining)} will still be due.` : ' Nothing will be left due.'}
        </Banner>

        <ErrorNotice error={take.error} />

        <button
          type="button"
          className="btn btn-block btn-lg"
          disabled={take.busy || amountPaise <= 0}
          onClick={() => void take.run()}
        >
          {take.busy ? 'Saving…' : `Receive ${money(amountPaise)}`}
        </button>
      </div>
    </Sheet>
  );
}

function EditCustomerSheet({
  open,
  customer,
  onClose,
  onSaved,
}: {
  open: boolean;
  customer: CustomerDetailResponse;
  onClose: () => void;
  onSaved: () => void;
}) {
  const sync = useSession((state) => state.sync);
  const [values, setValues] = useState<PartyValues>(() => partyValuesOf(customer));

  useEffect(() => {
    if (open) setValues(partyValuesOf(customer));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = useSubmit(async () => {
    await api.put(`/customers/${customer.id}`, partyBody('CUSTOMER', values));
    toast.success('Customer details saved.');
    void sync();
    onSaved();
  });

  return (
    <Sheet open={open} title="Edit customer" onClose={onClose}>
      <div className="stack">
        <PartyFields kind="CUSTOMER" values={values} onChange={setValues} />
        <p className="muted">What they owe is changed by bills and payments, not here.</p>
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
