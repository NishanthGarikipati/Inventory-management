import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api, newRequestId } from '../../lib/api';
import { db } from '../../lib/db';
import { applyLocalStockDelta, queueOperation } from '../../lib/sync';
import { money } from '../../lib/format';
import { toast } from '../../lib/toast';
import { PAYMENT_METHODS, useCart, type CartTotals } from '../../store/cart';
import { useSession } from '../../store/session';
import { useAsync, useSubmit } from '../../hooks/useAsync';
import {
  Banner,
  ErrorNotice,
  MoneyField,
  Sheet,
  SwitchRow,
  TextAreaField,
  TotalsRow,
} from '../../components/ui';
import type { CachedParty } from '../../lib/db';
import type { ErrorAction, PaymentMethod } from '../../lib/types';

interface SaleResponse {
  id: string;
  invoiceNumber: string;
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
  changePaise?: number;
}

interface Receipt {
  invoiceNumber: string;
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
  changePaise: number;
  saleId: string | null;
  offline: boolean;
}

/**
 * Taking the money. A bill can always be completed: if the network is gone the
 * sale is written to the phone's queue with its own request id and replayed
 * later, exactly once.
 */
export function Checkout({
  open,
  totals,
  onClose,
  onDone,
}: {
  open: boolean;
  totals: CartTotals;
  onClose: () => void;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const cart = useCart();
  const business = useSession((state) => state.business);
  const settings = useSession((state) => state.settings);
  const refreshPending = useSession((state) => state.refreshPending);
  const sync = useSession((state) => state.sync);

  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [split, setSplit] = useState(false);
  const [amounts, setAmounts] = useState<Record<PaymentMethod, number>>({
    CASH: 0,
    UPI: 0,
    CARD: 0,
    CREDIT: 0,
    OTHER: 0,
  });
  const [tenderedPaise, setTenderedPaise] = useState(0);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [overrideCredit, setOverrideCredit] = useState(false);

  useEffect(() => {
    if (open) {
      setTenderedPaise(totals.totalPaise);
      setAmounts({ CASH: 0, UPI: 0, CARD: 0, CREDIT: 0, OTHER: 0 });
      setSplit(false);
      setMethod('CASH');
      setOverrideCredit(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const payments = useMemo(() => {
    if (split) {
      return PAYMENT_METHODS.filter((entry) => entry.code !== 'CREDIT' && amounts[entry.code] > 0).map((entry) => ({
        method: entry.code,
        amountPaise: amounts[entry.code],
      }));
    }
    if (method === 'CREDIT') return [];
    if (method === 'CASH') return [{ method: 'CASH' as PaymentMethod, amountPaise: tenderedPaise }];
    return [{ method, amountPaise: totals.totalPaise }];
  }, [split, amounts, method, tenderedPaise, totals.totalPaise]);

  const tendered = payments.reduce((sum, payment) => sum + payment.amountPaise, 0);
  const changePaise = Math.max(0, tendered - totals.totalPaise);
  const duePaise = Math.max(0, totals.totalPaise - tendered);
  const needsCustomer = duePaise > 0 && !cart.customerId;

  const { run, busy, error, clearError } = useSubmit(async () => {
    const clientRequestId = newRequestId();
    const payload = {
      customerId: cart.customerId,
      items: cart.lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
        discountPaise: line.discountPaise,
        ...(line.serials?.length ? { serials: line.serials } : {}),
      })),
      discountPaise: cart.billDiscountPaise,
      payments,
      note: cart.note || undefined,
      clientRequestId,
    };
    const deltas = cart.lines.map((line) => ({ variantId: line.variantId, change: -line.quantity }));
    const summary = `Bill ${money(totals.totalPaise)}${cart.customerName ? ` · ${cart.customerName}` : ''}`;

    const saveOffline = async () => {
      await queueOperation({
        clientRequestId,
        businessId: business?.id ?? '',
        type: 'SALE',
        payload,
        summary,
      });
      await applyLocalStockDelta(business?.id ?? '', deltas);
      await refreshPending();
      setReceipt({
        invoiceNumber: 'Saved on this phone',
        totalPaise: totals.totalPaise,
        paidPaise: Math.min(tendered, totals.totalPaise),
        duePaise,
        changePaise,
        saleId: null,
        offline: true,
      });
      cart.clear();
    };

    if (!navigator.onLine) {
      await saveOffline();
      return;
    }

    try {
      const sale = await api.post<SaleResponse>('/sales', payload, clientRequestId);
      await applyLocalStockDelta(business?.id ?? '', deltas);
      setReceipt({
        invoiceNumber: sale.invoiceNumber,
        totalPaise: sale.totalPaise,
        paidPaise: sale.paidPaise,
        duePaise: sale.duePaise,
        changePaise: sale.changePaise ?? 0,
        saleId: sale.id,
        offline: false,
      });
      cart.clear();
      void sync();
    } catch (cause) {
      if (cause instanceof ApiError && cause.isOffline) {
        await saveOffline();
        return;
      }
      throw cause;
    }
  });

  const onErrorAction = (action: ErrorAction) => {
    if (action.action === 'SELECT_CUSTOMER') setCustomerPickerOpen(true);
    if (action.action === 'COLLECT_FULL') {
      setSplit(false);
      setMethod('CASH');
      setTenderedPaise(totals.totalPaise);
      clearError();
    }
    if (action.action === 'OVERRIDE_CREDIT_LIMIT') {
      setOverrideCredit(true);
      clearError();
      toast.info('Credit limit ignored for this bill. Take the payment soon.');
    }
    if (action.action === 'COLLECT_PAYMENT') {
      setSplit(false);
      setMethod('CASH');
      setTenderedPaise(totals.totalPaise);
      clearError();
    }
  };

  if (receipt) {
    return (
      <Sheet
        open
        title="Bill complete"
        onClose={() => {
          setReceipt(null);
          onDone();
        }}
      >
        <div className="stack">
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="muted">{receipt.invoiceNumber}</div>
            <div style={{ fontSize: '2.4rem', fontWeight: 800 }}>{money(receipt.totalPaise)}</div>
            {receipt.changePaise > 0 ? (
              <Banner tone="success" icon="💵">
                Return <strong>{money(receipt.changePaise)}</strong> change.
              </Banner>
            ) : null}
            {receipt.duePaise > 0 ? (
              <Banner tone="warning" icon="📒">
                {money(receipt.duePaise)} on credit.
              </Banner>
            ) : null}
            {receipt.offline ? (
              <Banner tone="info" icon="📤">
                Saved on this phone. It will be sent when you are back online.
              </Banner>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-block btn-lg"
            onClick={() => {
              setReceipt(null);
              onDone();
            }}
          >
            New Bill
          </button>
          {receipt.saleId ? (
            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={() => {
                const id = receipt.saleId;
                setReceipt(null);
                onDone();
                navigate(`/sales/${id}`);
              }}
            >
              View Receipt
            </button>
          ) : null}
        </div>
      </Sheet>
    );
  }

  return (
    <>
      <Sheet open={open} title="Payment" onClose={onClose}>
        <div className="stack">
          <div className="card">
            <TotalsRow label="Items" value={totals.itemCount} />
            <TotalsRow label="Subtotal" value={money(totals.subtotalPaise)} />
            {totals.discountPaise > 0 ? <TotalsRow label="Discount" value={`− ${money(totals.discountPaise)}`} /> : null}
            {settings?.taxEnabled ? <TotalsRow label={settings.taxLabel || 'Tax'} value={money(totals.taxPaise)} /> : null}
            <TotalsRow label="Total" value={money(totals.totalPaise)} grand />
          </div>

          <MoneyField
            label="Bill discount"
            valuePaise={cart.billDiscountPaise}
            onChange={cart.setBillDiscount}
            hint="Spread across the items on the bill."
          />

          <button type="button" className="list-item" onClick={() => setCustomerPickerOpen(true)}>
            <div className="avatar">👤</div>
            <div className="li-main">
              <div className="li-title">{cart.customerName ?? 'Walk-in customer'}</div>
              <div className="li-sub">{cart.customerId ? 'Tap to change' : 'Needed for credit bills'}</div>
            </div>
            <span className="chev">›</span>
          </button>

          <SwitchRow
            title="Split payment"
            description="Part cash, part UPI, and so on."
            checked={split}
            onChange={(value) => {
              setSplit(value);
              if (value) setAmounts((current) => ({ ...current, CASH: totals.totalPaise }));
            }}
          />

          {split ? (
            <div className="stack-sm">
              {PAYMENT_METHODS.filter((entry) => entry.code !== 'CREDIT').map((entry) => (
                <MoneyField
                  key={entry.code}
                  label={`${entry.icon} ${entry.label}`}
                  valuePaise={amounts[entry.code]}
                  onChange={(value) => setAmounts((current) => ({ ...current, [entry.code]: value }))}
                />
              ))}
            </div>
          ) : (
            <>
              <div className="quick-actions">
                {PAYMENT_METHODS.map((entry) => (
                  <button
                    key={entry.code}
                    type="button"
                    className={entry.code === method ? 'quick-action primary' : 'quick-action'}
                    onClick={() => {
                      setMethod(entry.code);
                      if (entry.code === 'CASH') setTenderedPaise(totals.totalPaise);
                    }}
                  >
                    <span className="qa-icon">{entry.icon}</span>
                    <span className="qa-label">{entry.label}</span>
                  </button>
                ))}
              </div>

              {method === 'CASH' ? (
                <>
                  <MoneyField label="Cash received" valuePaise={tenderedPaise} onChange={setTenderedPaise} />
                  <div className="chip-row">
                    {[totals.totalPaise, 10000, 20000, 50000, 100000]
                      .filter((value, index, all) => all.indexOf(value) === index && value >= totals.totalPaise)
                      .slice(0, 5)
                      .map((value) => (
                        <button key={value} type="button" className="chip" onClick={() => setTenderedPaise(value)}>
                          {money(value)}
                        </button>
                      ))}
                  </div>
                </>
              ) : null}
            </>
          )}

          {changePaise > 0 ? (
            <Banner tone="success" icon="💵">
              Change to return: <strong>{money(changePaise)}</strong>
            </Banner>
          ) : null}
          {duePaise > 0 ? (
            <Banner tone={needsCustomer ? 'warning' : 'info'} icon="📒">
              {needsCustomer
                ? `${money(duePaise)} is unpaid. Choose a customer before giving credit.`
                : `${money(duePaise)} will be added to ${cart.customerName}'s account.`}
            </Banner>
          ) : null}
          {overrideCredit ? (
            <Banner tone="warning" icon="⚠️">
              This bill crosses the customer's credit limit. The server will still refuse it unless the limit is raised
              in the customer's page.
            </Banner>
          ) : null}

          <TextAreaField label="Note (optional)" value={cart.note} onChange={cart.setNote} />

          <ErrorNotice error={error} onAction={onErrorAction} />

          <button
            type="button"
            className="btn btn-block btn-lg"
            disabled={busy || needsCustomer || totals.totalPaise <= 0}
            onClick={() => void run()}
          >
            {busy ? 'Saving…' : `Complete ${money(totals.totalPaise)}`}
          </button>
        </div>
      </Sheet>

      <CustomerPicker
        open={customerPickerOpen}
        onClose={() => setCustomerPickerOpen(false)}
        onPick={(customer) => {
          cart.setCustomer(customer?.id ?? null, customer?.name ?? null);
          setCustomerPickerOpen(false);
        }}
      />
    </>
  );
}

export function CustomerPicker({
  open,
  onClose,
  onPick,
  kind = 'CUSTOMER',
  title = 'Choose customer',
}: {
  open: boolean;
  onClose: () => void;
  onPick: (party: CachedParty | null) => void;
  kind?: 'CUSTOMER' | 'SUPPLIER';
  title?: string;
}) {
  const business = useSession((state) => state.business);
  const [search, setSearch] = useState('');
  const parties = useAsync(
    async () =>
      business?.id
        ? db.parties.where('[businessId+kind]').equals([business.id, kind]).limit(400).toArray()
        : ([] as CachedParty[]),
    [business?.id, kind, open],
  );

  const filtered = (parties.data ?? []).filter((party) =>
    `${party.name} ${party.phone ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <div className="stack">
        <input
          className="input"
          placeholder="Search by name or number"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="list">
          {kind === 'CUSTOMER' ? (
            <button type="button" className="list-item" onClick={() => onPick(null)}>
              <div className="avatar">🚶</div>
              <div className="li-main">
                <div className="li-title">Walk-in customer</div>
                <div className="li-sub">No account</div>
              </div>
            </button>
          ) : null}
          {filtered.slice(0, 60).map((party) => (
            <button key={party.id} type="button" className="list-item" onClick={() => onPick(party)}>
              <div className="avatar">{party.name.slice(0, 2).toUpperCase()}</div>
              <div className="li-main">
                <div className="li-title">{party.name}</div>
                <div className="li-sub">{party.phone ?? 'No number'}</div>
              </div>
              <div className="li-right">
                {party.balancePaise > 0 ? <div className="li-amount">{money(party.balancePaise)}</div> : null}
                {party.balancePaise > 0 ? <div className="li-sub">due</div> : null}
              </div>
            </button>
          ))}
          {!filtered.length ? <div style={{ padding: 16 }} className="muted">Nobody matches that.</div> : null}
        </div>
      </div>
    </Sheet>
  );
}
