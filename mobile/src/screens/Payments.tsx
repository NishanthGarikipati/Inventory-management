import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../components/AppShell';
import {
  Banner,
  Card,
  ChipRow,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  MoneyField,
  Screen,
  Sheet,
  StatTile,
  TextAreaField,
  TextField,
} from '../components/ui';
import { CustomerPicker } from './sell/Checkout';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { ApiError, api, newRequestId } from '../lib/api';
import { queueOperation } from '../lib/sync';
import { money } from '../lib/format';
import { toast } from '../lib/toast';
import { useSession } from '../store/session';
import type { CachedParty } from '../lib/db';
import type { PaymentMethod } from '../lib/types';

interface OutstandingParty {
  id: string;
  name: string;
  phone: string | null;
  balancePaise: number;
}

interface OutstandingReport {
  customers: OutstandingParty[];
  suppliers: OutstandingParty[];
  totals: { customerDuePaise: number; supplierDuePaise: number };
}

interface PaymentResponse {
  id: string;
  amountPaise: number;
  method: string;
  balanceAfterPaise: number;
  settledBills?: string[];
  settledPurchases?: string[];
}

interface PaymentDone {
  amountPaise: number;
  partyName: string;
  settled: string[];
  balanceAfterPaise: number | null;
  offline: boolean;
}

type PartyKind = 'CUSTOMER' | 'SUPPLIER';

const METHOD_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'CASH', label: '💵 Cash' },
  { value: 'UPI', label: '📱 UPI' },
  { value: 'CARD', label: '💳 Card' },
  { value: 'OTHER', label: '🧾 Other' },
];

/** Money that moved at the counter: taken from customers, paid to suppliers. */
export function Payments() {
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const connection = useSession((state) => state.connection);
  const [sheet, setSheet] = useState<PartyKind | null>(null);

  const outstanding = useAsync(() => api.get<OutstandingReport>('/reports/outstanding'), [connection === 'ONLINE']);
  const data = outstanding.data;

  return (
    <>
      <TopBar title="Payments" subtitle="Money taken and money paid" back />
      <Screen>
        {can('payment:create') ? (
          <div className="quick-actions">
            <button type="button" className="quick-action primary" onClick={() => setSheet('CUSTOMER')}>
              <span className="qa-icon">💵</span>
              <span className="qa-label">TAKE MONEY</span>
            </button>
            <button type="button" className="quick-action" onClick={() => setSheet('SUPPLIER')}>
              <span className="qa-icon">🚚</span>
              <span className="qa-label">PAY SUPPLIER</span>
            </button>
          </div>
        ) : (
          <Banner tone="info" icon="🔒">
            Ask the owner for permission to record payments.
          </Banner>
        )}

        <div className="stat-grid">
          <StatTile
            label="Money Due"
            value={money(data?.totals.customerDuePaise ?? 0)}
            note={`${data?.customers.length ?? 0} ${data?.customers.length === 1 ? 'customer' : 'customers'}`}
            accent
          />
          <StatTile
            label="You Owe"
            value={money(data?.totals.supplierDuePaise ?? 0)}
            note={`${data?.suppliers.length ?? 0} ${data?.suppliers.length === 1 ? 'supplier' : 'suppliers'}`}
          />
        </div>

        <ErrorNotice error={outstanding.error} onRetry={outstanding.reload} />
        {outstanding.loading && !data ? <Loading label="Checking the accounts…" /> : null}

        {data && !data.customers.length && !data.suppliers.length ? (
          <Empty icon="✅" title="Nothing pending" hint="Nobody owes you and you owe nobody." />
        ) : null}

        {data?.customers.length ? (
          <Card title="Money due to the shop" flush>
            <div className="list">
              {data.customers.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  className="list-item"
                  onClick={() => navigate(`/customers/${customer.id}`)}
                >
                  <div className="avatar">{customer.name.slice(0, 2).toUpperCase()}</div>
                  <div className="li-main">
                    <div className="li-title">{customer.name}</div>
                    <div className="li-sub">{customer.phone ?? 'No number'}</div>
                  </div>
                  <div className="li-right">
                    <div className="li-amount">{money(customer.balancePaise)}</div>
                    <div className="li-sub">to collect</div>
                  </div>
                </button>
              ))}
            </div>
          </Card>
        ) : null}

        {data?.suppliers.length ? (
          <Card title="What the shop owes" flush>
            <div className="list">
              {data.suppliers.map((supplier) => (
                <button
                  key={supplier.id}
                  type="button"
                  className="list-item"
                  onClick={() => navigate(`/suppliers/${supplier.id}`)}
                >
                  <div className="avatar">{supplier.name.slice(0, 2).toUpperCase()}</div>
                  <div className="li-main">
                    <div className="li-title">{supplier.name}</div>
                    <div className="li-sub">{supplier.phone ?? 'No number'}</div>
                  </div>
                  <div className="li-right">
                    <div className="li-amount">{money(supplier.balancePaise)}</div>
                    <div className="li-sub">to pay</div>
                  </div>
                </button>
              ))}
            </div>
          </Card>
        ) : null}
      </Screen>

      <PaymentSheet
        kind={sheet ?? 'CUSTOMER'}
        open={sheet !== null}
        onClose={() => setSheet(null)}
        onDone={() => {
          setSheet(null);
          outstanding.reload();
        }}
      />
    </>
  );
}

/**
 * One sheet for both directions. Customer money is queued when the line is
 * down, because a shop keeps taking cash whether or not the internet works.
 */
function PaymentSheet({
  kind,
  open,
  onClose,
  onDone,
}: {
  kind: PartyKind;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const business = useSession((state) => state.business);
  const refreshPending = useSession((state) => state.refreshPending);
  const sync = useSession((state) => state.sync);

  const [party, setParty] = useState<CachedParty | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [amountPaise, setAmountPaise] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState<PaymentDone | null>(null);

  useEffect(() => {
    if (!open) return;
    setParty(null);
    setAmountPaise(0);
    setMethod('CASH');
    setReference('');
    setNote('');
    setDone(null);
  }, [open, kind]);

  const taking = kind === 'CUSTOMER';

  const { run, busy, error } = useSubmit(async () => {
    if (!party || amountPaise <= 0) return;
    const clientRequestId = newRequestId();
    const payload = {
      ...(taking ? { customerId: party.id } : { supplierId: party.id }),
      amountPaise,
      method,
      reference: reference.trim() || undefined,
      note: note.trim() || undefined,
      clientRequestId,
    };
    const summary = `${money(amountPaise)} · ${party.name}`;

    const saveOffline = async () => {
      await queueOperation({
        clientRequestId,
        businessId: business?.id ?? '',
        type: taking ? 'CUSTOMER_PAYMENT' : 'SUPPLIER_PAYMENT',
        payload,
        summary,
      });
      await refreshPending();
      setDone({ amountPaise, partyName: party.name, settled: [], balanceAfterPaise: null, offline: true });
    };

    if (!navigator.onLine) {
      await saveOffline();
      return;
    }

    try {
      const payment = await api.post<PaymentResponse>(
        taking ? '/payments/customer' : '/payments/supplier',
        payload,
        clientRequestId,
      );
      setDone({
        amountPaise: payment.amountPaise,
        partyName: party.name,
        settled: payment.settledBills ?? payment.settledPurchases ?? [],
        balanceAfterPaise: payment.balanceAfterPaise,
        offline: false,
      });
      toast.success(taking ? 'Money received.' : 'Payment recorded.');
      void sync();
    } catch (cause) {
      if (cause instanceof ApiError && cause.isOffline) {
        await saveOffline();
        return;
      }
      throw cause;
    }
  });

  if (done) {
    return (
      <Sheet open title={taking ? 'Money received' : 'Payment done'} onClose={onDone}>
        <div className="stack">
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="muted">{done.partyName}</div>
            <div style={{ fontSize: '2.4rem', fontWeight: 800 }}>{money(done.amountPaise)}</div>
          </div>

          {done.offline ? (
            <Banner tone="info" icon="📤">
              Saved on this phone. It will be sent when you are back online, and the account will settle then.
            </Banner>
          ) : (
            <>
              <Banner tone="success" icon="✅">
                {balanceSentence(done.balanceAfterPaise ?? 0, done.partyName, taking)}
              </Banner>
              {done.settled.length ? (
                <Banner tone="info" icon="🧾">
                  This cleared {done.settled.join(', ')}. Money is always put against the oldest {taking ? 'bills' : 'purchases'}{' '}
                  first.
                </Banner>
              ) : null}
            </>
          )}

          <button type="button" className="btn btn-block btn-lg" onClick={onDone}>
            Done
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <>
      <Sheet open={open} title={taking ? 'Take money' : 'Pay supplier'} onClose={onClose}>
        <div className="stack">
          <button type="button" className="list-item" onClick={() => setPickerOpen(true)}>
            <div className="avatar">{party ? party.name.slice(0, 2).toUpperCase() : taking ? '👤' : '🚚'}</div>
            <div className="li-main">
              <div className="li-title">{party?.name ?? (taking ? 'Choose customer' : 'Choose supplier')}</div>
              <div className="li-sub">
                {party
                  ? party.balancePaise > 0
                    ? `${money(party.balancePaise)} ${taking ? 'due' : 'to pay'} · tap to change`
                    : 'Nothing pending · tap to change'
                  : 'Needed before saving'}
              </div>
            </div>
            <span className="chev">›</span>
          </button>

          <MoneyField
            label="Amount"
            valuePaise={amountPaise}
            onChange={setAmountPaise}
            hint={taking ? 'Goes against the oldest unpaid bills first.' : 'Goes against the oldest unpaid purchases first.'}
            autoFocus
          />

          {party && party.balancePaise > 0 && amountPaise > 0 && amountPaise < party.balancePaise ? (
            <Banner tone="info" icon="📒">
              {money(party.balancePaise - amountPaise)} will still be {taking ? 'due from' : 'owed to'} {party.name}.
            </Banner>
          ) : null}
          {party && amountPaise > party.balancePaise ? (
            <Banner tone="warning" icon="⚠️">
              This is more than the {money(Math.max(0, party.balancePaise))} pending. The extra stays as an advance.
            </Banner>
          ) : null}

          {party && party.balancePaise > 0 ? (
            <div className="chip-row">
              <button type="button" className="chip" onClick={() => setAmountPaise(party.balancePaise)}>
                Full {money(party.balancePaise)}
              </button>
              <button type="button" className="chip" onClick={() => setAmountPaise(Math.round(party.balancePaise / 2))}>
                Half
              </button>
            </div>
          ) : null}

          <Field label="Paid by">
            <ChipRow value={method} onChange={setMethod} options={METHOD_OPTIONS} />
          </Field>

          {method !== 'CASH' ? (
            <TextField
              label="Reference (optional)"
              value={reference}
              onChange={setReference}
              placeholder="UPI number, cheque number"
            />
          ) : null}

          <TextAreaField label="Note (optional)" value={note} onChange={setNote} />

          <ErrorNotice error={error} />

          <button
            type="button"
            className="btn btn-block btn-lg"
            disabled={busy || !party || amountPaise <= 0}
            onClick={() => void run()}
          >
            {busy ? 'Saving…' : taking ? `Take ${money(amountPaise)}` : `Pay ${money(amountPaise)}`}
          </button>
        </div>
      </Sheet>

      <CustomerPicker
        open={pickerOpen}
        kind={kind}
        title={taking ? 'Choose customer' : 'Choose supplier'}
        onClose={() => setPickerOpen(false)}
        onPick={(picked) => {
          if (picked) {
            setParty(picked);
            if (!amountPaise && picked.balancePaise > 0) setAmountPaise(picked.balancePaise);
          }
          setPickerOpen(false);
        }}
      />
    </>
  );
}

function balanceSentence(balancePaise: number, name: string, taking: boolean): string {
  if (balancePaise > 0) return `${name} still has ${money(balancePaise)} ${taking ? 'to pay' : 'to be paid'}.`;
  if (balancePaise < 0) return `${name}'s account is settled, with ${money(-balancePaise)} extra as an advance.`;
  return `${name}'s account is fully settled.`;
}
