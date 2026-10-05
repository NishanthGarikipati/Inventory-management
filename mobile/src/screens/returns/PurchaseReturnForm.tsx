import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TopBar } from '../../components/AppShell';
import { ProductPicker, type PickedProduct } from '../../components/ProductPicker';
import { CustomerPicker } from '../sell/Checkout';
import { Banner, ChipRow, ErrorNotice, Field, Loading, MoneyField, NumberField, Screen, TextField } from '../../components/ui';
import { useAsync, useSubmit } from '../../hooks/useAsync';
import { api, newRequestId } from '../../lib/api';
import { money, quantity as qtyLabel } from '../../lib/format';
import { toast } from '../../lib/toast';
import type { CachedParty } from '../../lib/db';

interface PurchaseItem {
  id: string;
  variantId: string;
  productName: string;
  quantity: number;
  returnedQty: number;
  unitCostPaise: number;
}

interface PurchaseResponse {
  id: string;
  invoiceNumber: string | null;
  status: string;
  supplier: { id: string; name: string } | null;
  items: PurchaseItem[];
}

interface DraftLine {
  key: string;
  purchaseItemId?: string;
  variantId: string;
  name: string;
  max: number | null;
  quantity: number;
  unitCostPaise: number;
  allowDecimal: boolean;
  stock: number | null;
}

const REASONS = ['Damaged', 'Expired', 'Wrong item', 'Extra sent', 'Other'];

const SETTLEMENTS = [
  { value: 'ADJUST_DUE', label: 'Reduce what we owe' },
  { value: 'CASH_REFUND', label: 'Supplier pays cash' },
] as const;

type Settlement = (typeof SETTLEMENTS)[number]['value'];

/** Goods going back to the supplier. Stock goes down and the due goes down with it. */
export function PurchaseReturnForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const purchaseId = params.get('purchaseId') ?? '';

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [supplier, setSupplier] = useState<CachedParty | null>(null);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [reason, setReason] = useState('Damaged');
  const [otherReason, setOtherReason] = useState('');
  const [settlement, setSettlement] = useState<Settlement>('ADJUST_DUE');
  const [pickerOpen, setPickerOpen] = useState(false);

  const purchase = useAsync(async () => {
    if (!purchaseId) return null;
    return api.get<PurchaseResponse>(`/purchases/${purchaseId}`);
  }, [purchaseId]);

  useEffect(() => {
    if (!purchase.data) return;
    setLines(
      purchase.data.items
        .map((item) => {
          const remaining = Number((item.quantity - item.returnedQty).toFixed(3));
          return {
            key: item.id,
            purchaseItemId: item.id,
            variantId: item.variantId,
            name: item.productName,
            max: remaining,
            quantity: 0,
            unitCostPaise: item.unitCostPaise,
            allowDecimal: !Number.isInteger(item.quantity),
            stock: null,
          };
        })
        .filter((line) => (line.max ?? 0) > 0),
    );
  }, [purchase.data]);

  const addLoose = (product: PickedProduct) => {
    setPickerOpen(false);
    setLines((current) => [
      ...current,
      {
        key: product.variantId,
        variantId: product.variantId,
        name: product.name,
        max: product.stock,
        quantity: 1,
        unitCostPaise: product.purchasePricePaise,
        allowDecimal: product.allowDecimal,
        stock: product.stock,
      },
    ]);
  };

  const chosen = lines.filter((line) => line.quantity > 0);
  const totalPaise = chosen.reduce((sum, line) => sum + Math.round(line.unitCostPaise * line.quantity), 0);
  const reasonText = reason === 'Other' ? otherReason.trim() : reason;
  const supplierId = purchase.data?.supplier?.id ?? supplier?.id;

  const save = useSubmit(async () => {
    const clientRequestId = newRequestId();
    const created = await api.post<{ returnNumber: string }>(
      '/returns/purchases',
      {
        purchaseId: purchase.data?.id,
        supplierId,
        reason: reasonText,
        settlement,
        items: chosen.map((line) => ({
          purchaseItemId: line.purchaseItemId,
          variantId: line.variantId,
          quantity: line.quantity,
          unitCostPaise: line.unitCostPaise,
        })),
        clientRequestId,
      },
      clientRequestId,
    );
    toast.success(`${created.returnNumber} saved. Stock is reduced.`);
    navigate('/returns', { replace: true });
  });

  return (
    <>
      <TopBar title="Return to Supplier" back />
      <Screen>
        <div className="stack">
          {purchase.loading ? <Loading label="Opening the purchase…" /> : null}
          <ErrorNotice error={purchase.error} onRetry={purchase.reload} />

          {purchase.data ? (
            <Banner tone="info" icon="📥">
              {purchase.data.invoiceNumber ?? 'Purchase'}
              {purchase.data.supplier ? ` · ${purchase.data.supplier.name}` : ''}
            </Banner>
          ) : (
            <button type="button" className="list-item" onClick={() => setSupplierOpen(true)}>
              <div className="avatar">{supplier ? supplier.name.slice(0, 2).toUpperCase() : '🚚'}</div>
              <div className="li-main">
                <div className="li-title">{supplier?.name ?? 'Choose supplier'}</div>
                <div className="li-sub">So the amount can come off what you owe them</div>
              </div>
              <span className="chev">›</span>
            </button>
          )}

          {lines.map((line) => (
            <div className="cart-line" key={line.key}>
              <strong>{line.name}</strong>
              <div className="li-sub">
                {line.max !== null ? `${qtyLabel(line.max)} can go back · ` : ''}
                {money(line.unitCostPaise)} each
              </div>
              <NumberField
                label="Quantity going back"
                value={line.quantity}
                allowDecimal={line.allowDecimal}
                onChange={(quantity) =>
                  setLines((current) =>
                    current.map((item) =>
                      item.key === line.key
                        ? {
                            ...item,
                            quantity: line.max !== null ? Math.min(line.max, Math.max(0, quantity)) : Math.max(0, quantity),
                          }
                        : item,
                    ),
                  )
                }
              />
              {!line.purchaseItemId ? (
                <MoneyField
                  label="Cost"
                  valuePaise={line.unitCostPaise}
                  onChange={(unitCostPaise) =>
                    setLines((current) => current.map((item) => (item.key === line.key ? { ...item, unitCostPaise } : item)))
                  }
                />
              ) : null}
            </div>
          ))}

          {!purchaseId ? (
            <button type="button" className="btn btn-secondary btn-block" onClick={() => setPickerOpen(true)}>
              Add Product
            </button>
          ) : null}

          <Field label="Reason">
            <ChipRow value={reason} onChange={setReason} options={REASONS.map((value) => ({ value, label: value }))} />
          </Field>
          {reason === 'Other' ? <TextField label="Say why" value={otherReason} onChange={setOtherReason} /> : null}

          <Field label="How is it settled?">
            <ChipRow value={settlement} onChange={setSettlement} options={[...SETTLEMENTS]} />
          </Field>

          {chosen.length ? (
            <Banner tone="info" icon="↪️">
              {money(totalPaise)} of stock leaves the shop.
              {settlement === 'ADJUST_DUE' ? ' The same amount comes off what you owe.' : ' Collect the cash from the supplier.'}
            </Banner>
          ) : null}

          {!supplierId && settlement === 'ADJUST_DUE' && chosen.length ? (
            <Banner tone="warning" icon="🚚">
              Choose a supplier so their account can be reduced.
            </Banner>
          ) : null}

          <ErrorNotice error={save.error} />
          <button
            type="button"
            className="btn btn-block btn-lg"
            disabled={
              save.busy ||
              !chosen.length ||
              reasonText.length < 2 ||
              (settlement === 'ADJUST_DUE' && !supplierId)
            }
            onClick={() => void save.run()}
          >
            {save.busy ? 'Saving…' : 'Save Return'}
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
      <ProductPicker open={pickerOpen} title="Product going back" onClose={() => setPickerOpen(false)} onPick={addLoose} />
    </>
  );
}
