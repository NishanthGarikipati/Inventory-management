import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../../components/AppShell';
import { ProductPicker, type PickedProduct } from '../../components/ProductPicker';
import { CustomerPicker } from '../sell/Checkout';
import {
  Banner,
  ErrorNotice,
  Field,
  MoneyField,
  NumberField,
  Screen,
  TextAreaField,
  TextField,
} from '../../components/ui';
import { useSubmit } from '../../hooks/useAsync';
import { ApiError, api, newRequestId } from '../../lib/api';
import { money, quantity as qtyLabel } from '../../lib/format';
import { queueOperation } from '../../lib/sync';
import { toast } from '../../lib/toast';
import { useSession } from '../../store/session';
import type { CachedParty } from '../../lib/db';
import type { PaymentMethod } from '../../lib/types';

interface DraftLine {
  variantId: string;
  name: string;
  unit: string;
  allowDecimal: boolean;
  trackBatch: boolean;
  quantity: number;
  unitCostPaise: number;
  batchNumber: string;
  expiryDate: string;
}

type PayMode = 'FULL' | 'PARTIAL' | 'CREDIT';

const PAY_MODES: Array<{ value: PayMode; label: string }> = [
  { value: 'FULL', label: 'Paid now' },
  { value: 'PARTIAL', label: 'Part paid' },
  { value: 'CREDIT', label: 'On credit' },
];

const METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
];

const todayValue = (): string => new Date().toISOString().slice(0, 10);

/** A purchase written by hand: supplier, products, what was paid. */
export function PurchaseForm() {
  const navigate = useNavigate();
  const business = useSession((state) => state.business);
  const refreshPending = useSession((state) => state.refreshPending);

  const [supplier, setSupplier] = useState<CachedParty | null>(null);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(todayValue);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [payMode, setPayMode] = useState<PayMode>('FULL');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [paidPaise, setPaidPaise] = useState(0);

  const goodsPaise = useMemo(
    () => lines.reduce((sum, line) => sum + Math.round(line.unitCostPaise * line.quantity), 0),
    [lines],
  );
  const payingPaise = payMode === 'FULL' ? goodsPaise : payMode === 'PARTIAL' ? Math.min(paidPaise, goodsPaise) : 0;
  const duePaise = Math.max(0, goodsPaise - payingPaise);

  const addProduct = (product: PickedProduct) => {
    setPickerOpen(false);
    setLines((current) => {
      const existing = current.find((line) => line.variantId === product.variantId);
      if (existing) {
        return current.map((line) =>
          line.variantId === product.variantId
            ? { ...line, quantity: Number((line.quantity + 1).toFixed(3)) }
            : line,
        );
      }
      return [
        ...current,
        {
          variantId: product.variantId,
          name: product.name,
          unit: product.unit,
          allowDecimal: product.allowDecimal,
          trackBatch: product.trackBatch,
          quantity: 1,
          unitCostPaise: product.purchasePricePaise,
          batchNumber: '',
          expiryDate: '',
        },
      ];
    });
  };

  const update = (variantId: string, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line) => (line.variantId === variantId ? { ...line, ...patch } : line)));
  };

  const { run, busy, error } = useSubmit(async () => {
    if (!lines.length) return;
    const clientRequestId = newRequestId();
    const payload = {
      supplierId: supplier?.id ?? null,
      invoiceNumber: invoiceNumber.trim() || null,
      purchaseDate,
      note: note.trim() || undefined,
      items: lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        unitCostPaise: line.unitCostPaise,
        batchNumber: line.batchNumber.trim() || null,
        expiryDate: line.expiryDate || null,
      })),
      payments: payingPaise > 0 ? [{ method, amountPaise: payingPaise }] : [],
      clientRequestId,
    };

    const saveOffline = async () => {
      await queueOperation({
        clientRequestId,
        businessId: business?.id ?? '',
        type: 'PURCHASE',
        payload,
        summary: `Purchase ${money(goodsPaise)}${supplier ? ` · ${supplier.name}` : ''}`,
      });
      await refreshPending();
      toast.success('Purchase saved on this phone. It will be sent when you are back online.');
      navigate('/purchases');
    };

    if (!navigator.onLine) {
      await saveOffline();
      return;
    }

    try {
      const created = await api.post<{ id: string }>( '/purchases', payload, clientRequestId);
      toast.success('Purchase saved. Stock is updated.');
      navigate(`/purchases/${created.id}`, { replace: true });
    } catch (cause) {
      if (cause instanceof ApiError && cause.isOffline) {
        await saveOffline();
        return;
      }
      throw cause;
    }
  });

  const needsSupplier = duePaise > 0 && !supplier;

  return (
    <>
      <TopBar title="New Purchase" back />
      <Screen>
        <div className="stack">
          <button type="button" className="list-item" onClick={() => setSupplierOpen(true)}>
            <div className="avatar">{supplier ? supplier.name.slice(0, 2).toUpperCase() : '🚚'}</div>
            <div className="li-main">
              <div className="li-title">{supplier?.name ?? 'Choose supplier'}</div>
              <div className="li-sub">
                {supplier
                  ? supplier.balancePaise > 0
                    ? `${money(supplier.balancePaise)} already due · tap to change`
                    : 'Tap to change'
                  : 'Needed when you do not pay in full'}
              </div>
            </div>
            <span className="chev">›</span>
          </button>

          <div className="form-grid">
            <TextField label="Invoice number" value={invoiceNumber} onChange={setInvoiceNumber} placeholder="Optional" />
            <TextField label="Date" type="date" value={purchaseDate} onChange={setPurchaseDate} />
          </div>

          {lines.map((line) => (
            <div className="cart-line" key={line.variantId}>
              <div className="cart-line-top">
                <div className="grow">
                  <strong>{line.name}</strong>
                  <div className="li-sub">{money(Math.round(line.unitCostPaise * line.quantity))}</div>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines((current) => current.filter((item) => item.variantId !== line.variantId))}>
                  Remove
                </button>
              </div>
              <div className="form-grid">
                <NumberField
                  label={`Quantity (${line.unit.toLowerCase()})`}
                  value={line.quantity}
                  allowDecimal={line.allowDecimal}
                  onChange={(quantity) => update(line.variantId, { quantity: Math.max(0, quantity) })}
                />
                <MoneyField
                  label="Purchase price"
                  valuePaise={line.unitCostPaise}
                  onChange={(unitCostPaise) => update(line.variantId, { unitCostPaise })}
                />
              </div>
              {line.trackBatch ? (
                <div className="form-grid">
                  <TextField
                    label="Batch"
                    value={line.batchNumber}
                    onChange={(batchNumber) => update(line.variantId, { batchNumber })}
                    placeholder="Batch number"
                  />
                  <TextField
                    label="Expiry"
                    type="date"
                    value={line.expiryDate}
                    onChange={(expiryDate) => update(line.variantId, { expiryDate })}
                  />
                </div>
              ) : null}
              {line.quantity <= 0 ? <span className="error-text">Quantity must be more than zero.</span> : null}
            </div>
          ))}

          <button type="button" className="btn btn-secondary btn-block" onClick={() => setPickerOpen(true)}>
            Add Product
          </button>

          {lines.length ? (
            <>
              <Field label="Payment">
                <div className="chip-row">
                  {PAY_MODES.map((entry) => (
                    <button
                      key={entry.value}
                      type="button"
                      className={entry.value === payMode ? 'chip active' : 'chip'}
                      onClick={() => setPayMode(entry.value)}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              </Field>

              {payMode !== 'CREDIT' ? (
                <Field label="Paid by">
                  <div className="chip-row">
                    {METHODS.map((entry) => (
                      <button
                        key={entry.value}
                        type="button"
                        className={entry.value === method ? 'chip active' : 'chip'}
                        onClick={() => setMethod(entry.value)}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                </Field>
              ) : null}

              {payMode === 'PARTIAL' ? (
                <MoneyField label="Amount paid now" valuePaise={paidPaise} onChange={setPaidPaise} />
              ) : null}

              <div className="card">
                <div className="totals-row">
                  <span>Goods</span>
                  <span>{money(goodsPaise)}</span>
                </div>
                <div className="totals-row">
                  <span>Paying now</span>
                  <span>{money(payingPaise)}</span>
                </div>
                <div className="totals-row grand">
                  <span>Still due</span>
                  <span>{money(duePaise)}</span>
                </div>
                <p className="muted" style={{ marginTop: 8 }}>
                  Tax is added when you save, using each product's tax rate. {qtyLabel(lines.length)}{' '}
                  {lines.length === 1 ? 'product' : 'products'}.
                </p>
              </div>
            </>
          ) : null}

          {needsSupplier ? (
            <Banner tone="warning" icon="🚚">
              Choose a supplier so the unpaid amount can be tracked.
            </Banner>
          ) : null}

          <TextAreaField label="Note (optional)" value={note} onChange={setNote} />
          <ErrorNotice error={error} />

          <button
            type="button"
            className="btn btn-block btn-lg"
            disabled={busy || !lines.length || lines.some((line) => line.quantity <= 0) || needsSupplier}
            onClick={() => void run()}
          >
            {busy ? 'Saving…' : 'Save Purchase'}
          </button>
        </div>
      </Screen>

      <CustomerPicker
        open={supplierOpen}
        kind="SUPPLIER"
        title="Choose supplier"
        onClose={() => setSupplierOpen(false)}
        onPick={(picked) => {
          if (picked) setSupplier(picked);
          setSupplierOpen(false);
        }}
      />
      <ProductPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addProduct} />
    </>
  );
}
