import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TopBar } from '../../components/AppShell';
import { ProductPicker, type PickedProduct } from '../../components/ProductPicker';
import {
  Banner,
  ChipRow,
  ErrorNotice,
  Field,
  Loading,
  MoneyField,
  NumberField,
  Screen,
  SwitchRow,
  TextField,
} from '../../components/ui';
import { useAsync, useSubmit } from '../../hooks/useAsync';
import { api, newRequestId } from '../../lib/api';
import { money, quantity as qtyLabel } from '../../lib/format';
import { toast } from '../../lib/toast';

interface SaleItem {
  id: string;
  variantId: string;
  productName: string;
  quantity: number;
  returnedQty: number;
  unitPricePaise: number;
  totalPaise: number;
  discountPaise: number;
}

interface SaleResponse {
  id: string;
  invoiceNumber: string;
  status: string;
  customer: { id: string; name: string } | null;
  items: SaleItem[];
}

interface SearchResponse {
  sales: Array<{ id: string; invoiceNumber: string; totalPaise: number }>;
}

interface DraftLine {
  key: string;
  saleItemId?: string;
  variantId: string;
  name: string;
  max: number | null;
  quantity: number;
  unitPricePaise: number;
  allowDecimal: boolean;
  restock: boolean;
}

const REASONS = ['Damaged', 'Wrong item', 'Expired', 'Changed mind', 'Other'];

const REFUND_OPTIONS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'ADJUST_DUE', label: 'Reduce dues' },
  { value: 'CREDIT_NOTE', label: 'Credit note' },
] as const;

type RefundMethod = (typeof REFUND_OPTIONS)[number]['value'];

/** A customer brings goods back. Stock and money both move, and only once. */
export function SalesReturnForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const presetSaleId = params.get('saleId') ?? '';

  const [billQuery, setBillQuery] = useState('');
  const [saleId, setSaleId] = useState(presetSaleId);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [reason, setReason] = useState('Damaged');
  const [otherReason, setOtherReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('CASH');
  const [pickerOpen, setPickerOpen] = useState(false);

  const sale = useAsync(async () => {
    if (!saleId) return null;
    return api.get<SaleResponse>(`/sales/${saleId}`);
  }, [saleId]);

  useEffect(() => {
    if (!sale.data) return;
    setLines(
      sale.data.items
        .map((item) => {
          const remaining = Number((item.quantity - item.returnedQty).toFixed(3));
          const unitPricePaise =
            item.quantity > 0 ? Math.round((item.totalPaise - item.discountPaise) / item.quantity) : item.unitPricePaise;
          return {
            key: item.id,
            saleItemId: item.id,
            variantId: item.variantId,
            name: item.productName,
            max: remaining,
            quantity: 0,
            unitPricePaise,
            allowDecimal: !Number.isInteger(item.quantity),
            restock: true,
          };
        })
        .filter((line) => (line.max ?? 0) > 0),
    );
  }, [sale.data]);

  const findBill = useSubmit(async () => {
    const query = billQuery.trim();
    if (!query) return;
    const found = await api.get<SearchResponse>('/search', { q: query });
    const match =
      found.sales.find((entry) => entry.invoiceNumber.toLowerCase() === query.toLowerCase()) ?? found.sales[0];
    if (!match) {
      toast.info('No bill with that number.');
      return;
    }
    setSaleId(match.id);
  });

  const addLoose = (product: PickedProduct) => {
    setPickerOpen(false);
    setLines((current) => [
      ...current,
      {
        key: product.variantId,
        variantId: product.variantId,
        name: product.name,
        max: null,
        quantity: 1,
        unitPricePaise: product.sellingPricePaise,
        allowDecimal: product.allowDecimal,
        restock: true,
      },
    ]);
  };

  const chosen = lines.filter((line) => line.quantity > 0);
  const totalPaise = chosen.reduce((sum, line) => sum + Math.round(line.unitPricePaise * line.quantity), 0);
  const reasonText = reason === 'Other' ? otherReason.trim() : reason;

  const save = useSubmit(async () => {
    const clientRequestId = newRequestId();
    const created = await api.post<{ id: string; returnNumber: string }>(
      '/returns/sales',
      {
        saleId: sale.data?.id,
        customerId: sale.data?.customer?.id,
        reason: reasonText,
        refundMethod,
        items: chosen.map((line) => ({
          saleItemId: line.saleItemId,
          variantId: line.variantId,
          quantity: line.quantity,
          unitPricePaise: line.unitPricePaise,
          restock: line.restock,
        })),
        clientRequestId,
      },
      clientRequestId,
    );
    toast.success(`${created.returnNumber} saved. Stock is updated.`);
    navigate('/returns', { replace: true });
  });

  return (
    <>
      <TopBar title="Customer Return" back />
      <Screen>
        <div className="stack">
          {!presetSaleId ? (
            <div className="row">
              <TextField label="Bill number" value={billQuery} onChange={setBillQuery} placeholder="INV-0001" />
              <button
                type="button"
                className="btn btn-secondary"
                style={{ alignSelf: 'end' }}
                disabled={findBill.busy || billQuery.trim().length < 2}
                onClick={() => void findBill.run()}
              >
                Find
              </button>
            </div>
          ) : null}
          <ErrorNotice error={findBill.error} />

          {sale.loading ? <Loading label="Opening the bill…" /> : null}
          <ErrorNotice error={sale.error} onRetry={sale.reload} />

          {sale.data ? (
            <Banner tone="info" icon="🧾">
              {sale.data.invoiceNumber}
              {sale.data.customer ? ` · ${sale.data.customer.name}` : ' · Walk-in'}
              {sale.data.status === 'CANCELLED' ? ' · this bill is already cancelled' : ''}
            </Banner>
          ) : null}

          {lines.map((line) => (
            <div className="cart-line" key={line.key}>
              <div className="cart-line-top">
                <div className="grow">
                  <strong>{line.name}</strong>
                  <div className="li-sub">
                    {line.max !== null ? `${qtyLabel(line.max)} can still come back · ` : ''}
                    {money(line.unitPricePaise)} each
                  </div>
                </div>
              </div>
              <NumberField
                label="Quantity coming back"
                value={line.quantity}
                allowDecimal={line.allowDecimal}
                onChange={(quantity) =>
                  setLines((current) =>
                    current.map((item) =>
                      item.key === line.key
                        ? { ...item, quantity: line.max !== null ? Math.min(line.max, Math.max(0, quantity)) : Math.max(0, quantity) }
                        : item,
                    ),
                  )
                }
              />
              {!line.saleItemId ? (
                <MoneyField
                  label="Refund price"
                  valuePaise={line.unitPricePaise}
                  onChange={(unitPricePaise) =>
                    setLines((current) => current.map((item) => (item.key === line.key ? { ...item, unitPricePaise } : item)))
                  }
                />
              ) : null}
              <SwitchRow
                title="Put it back on the shelf"
                description="Turn off if it is damaged and cannot be sold again."
                checked={line.restock}
                onChange={(restock) =>
                  setLines((current) => current.map((item) => (item.key === line.key ? { ...item, restock } : item)))
                }
              />
            </div>
          ))}

          {!saleId ? (
            <button type="button" className="btn btn-secondary btn-block" onClick={() => setPickerOpen(true)}>
              Add Product Without a Bill
            </button>
          ) : null}

          <Field label="Reason">
            <ChipRow
              value={reason}
              onChange={setReason}
              options={REASONS.map((value) => ({ value, label: value }))}
            />
          </Field>
          {reason === 'Other' ? <TextField label="Say why" value={otherReason} onChange={setOtherReason} /> : null}

          <Field label="How is the money returned?">
            <ChipRow value={refundMethod} onChange={setRefundMethod} options={[...REFUND_OPTIONS]} />
          </Field>

          {chosen.length ? (
            <Banner tone="info" icon="↩️">
              {money(totalPaise)} for {chosen.length} {chosen.length === 1 ? 'product' : 'products'}.
              {refundMethod === 'ADJUST_DUE' || refundMethod === 'CREDIT_NOTE'
                ? ' No cash leaves the till — it comes off the customer account.'
                : ' Give this amount back to the customer.'}
            </Banner>
          ) : null}

          <ErrorNotice error={save.error} />
          <button
            type="button"
            className="btn btn-block btn-lg"
            disabled={save.busy || !chosen.length || reasonText.length < 2}
            onClick={() => void save.run()}
          >
            {save.busy ? 'Saving…' : 'Save Return'}
          </button>
        </div>
      </Screen>
      <ProductPicker open={pickerOpen} title="Product coming back" onClose={() => setPickerOpen(false)} onPick={addLoose} />
    </>
  );
}
