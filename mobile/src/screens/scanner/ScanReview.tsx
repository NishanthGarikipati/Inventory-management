import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '../../components/AppShell';
import {
  Badge,
  Banner,
  Card,
  ErrorNotice,
  Loading,
  MoneyField,
  NumberField,
  Screen,
  Sheet,
  TextField,
} from '../../components/ui';
import { CustomerPicker } from '../sell/Checkout';
import { useAsync, useSubmit } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { localSellables } from '../../lib/sync';
import { dateLabel, money, percent, quantity as qtyLabel } from '../../lib/format';
import { toast } from '../../lib/toast';
import { useSession } from '../../store/session';
import type { ErrorAction, ScanDetail, ScanItem, SellableItem } from '../../lib/types';

const TITLES: Record<string, string> = {
  INVOICE: 'Smart Stock Update',
  RECEIPT: 'Smart Stock Update',
  PRODUCT: 'Product Label',
  SHELF: 'Smart Stock Count',
  STOCK_SHEET: 'Detected Stock',
};

/**
 * The gate between what a model read off a photo and what the shop's books
 * say. Nothing is applied until the owner ticks the lines and confirms, and
 * every edit made here is recorded against the original extraction.
 */
export function ScanReview() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const can = useSession((state) => state.can);

  const scan = useAsync(() => api.get<ScanDetail>(`/scanner/${id}`), [id]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ScanItem | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const data = scan.data;
  const approved = data?.status === 'APPROVED';
  const rejected = data?.status === 'REJECTED';

  useEffect(() => {
    if (!data) return;
    // High confidence lines start ticked; everything else is an explicit choice.
    setSelected(new Set(data.items.filter((item) => item.suggestedForApproval).map((item) => item.id)));
  }, [data?.id, data?.items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocked = useMemo(
    () => new Set((data?.items ?? []).filter((item) => item.issues.some((issue) => issue.severity === 'BLOCK')).map((i) => i.id)),
    [data],
  );

  const toggle = (itemId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const reject = useSubmit(async () => {
    await api.post(`/scanner/${id}/reject`, { reason: rejectReason || 'Not correct' });
    toast.info('Scan cancelled. Nothing was changed in your stock.');
    setRejectOpen(false);
    scan.reload();
  });

  if (scan.loading && !data) {
    return (
      <>
        <TopBar title="Scan" back />
        <Loading label="Opening the scan…" />
      </>
    );
  }

  return (
    <>
      <TopBar
        title={TITLES[data?.scanType ?? ''] ?? 'Scan'}
        back
        subtitle={data ? `${data.items.length} products detected` : undefined}
      />
      <Screen>
        <ErrorNotice error={scan.error} onRetry={scan.reload} />

        {data?.status === 'FAILED' ? (
          <Banner
            tone="danger"
            icon="⚠️"
            actions={
              <button type="button" className="btn btn-sm btn-outline" onClick={() => navigate('/purchases/new')}>
                Enter Manually
              </button>
            }
          >
            {data.failureReason ?? 'We could not read this photo.'}
          </Banner>
        ) : null}

        {approved ? (
          <Banner
            tone="success"
            icon="✅"
            actions={
              data?.resultRefType === 'Purchase' && data.resultRefId ? (
                <button type="button" className="btn btn-sm btn-outline" onClick={() => navigate(`/purchases/${data.resultRefId}`)}>
                  Open Purchase
                </button>
              ) : null
            }
          >
            Confirmed. {data?.resultRefType === 'Purchase' ? 'A purchase was created and stock went up.' : null}
            {data?.resultRefType === 'StockAdjustment' ? 'Stock was counted and adjusted.' : null}
            {data?.resultRefType === 'Product' ? 'Product details were updated. Stock did not change.' : null}
          </Banner>
        ) : null}

        {rejected ? (
          <Banner tone="warning" icon="🚫">
            This scan was cancelled. Nothing was changed in your stock.
          </Banner>
        ) : null}

        {data ? (
          <Card title="What we read">
            <div className="row-between">
              <span>Supplier</span>
              <strong>{data.extractedSupplierName ?? 'Not found'}</strong>
            </div>
            <div className="row-between" style={{ marginTop: 6 }}>
              <span>Invoice number</span>
              <strong>{data.invoiceNumber ?? '—'}</strong>
            </div>
            <div className="row-between" style={{ marginTop: 6 }}>
              <span>Invoice date</span>
              <strong>{data.invoiceDate ? dateLabel(data.invoiceDate) : '—'}</strong>
            </div>
            <div className="row-between" style={{ marginTop: 6 }}>
              <span>Overall confidence</span>
              <Badge tone={data.overallConfidence >= data.thresholds.high ? 'green' : data.overallConfidence >= data.thresholds.medium ? 'amber' : 'red'}>
                {percent(data.overallConfidence)}
              </Badge>
            </div>
          </Card>
        ) : null}

        {data?.scanType === 'SHELF' ? (
          <Banner tone="warning" icon="⚠️">
            Counting from a photo is a guess. Check each number before you confirm.
          </Banner>
        ) : null}

        <div className="stack-sm">
          {(data?.items ?? []).map((item) => (
            <ScanItemCard
              key={item.id}
              item={item}
              thresholds={data!.thresholds}
              checked={selected.has(item.id)}
              locked={approved || rejected}
              blocked={blocked.has(item.id)}
              onToggle={() => toggle(item.id)}
              onEdit={() => setEditing(item)}
            />
          ))}
        </div>

        {!approved && !rejected && data?.items.length ? (
          <>
            <Banner tone="info" icon="🔒">
              Nothing changes in your stock until you press Confirm.
            </Banner>
            <div className="row">
              <button type="button" className="btn btn-secondary grow" onClick={() => setRejectOpen(true)}>
                Cancel Scan
              </button>
              <button
                type="button"
                className="btn grow btn-lg"
                disabled={!selected.size || !can('scanner:approve')}
                onClick={() => setConfirmOpen(true)}
              >
                Confirm {selected.size}
              </button>
            </div>
            {!can('scanner:approve') ? (
              <p className="muted">Your role can read scans but not confirm them. Ask the owner or manager.</p>
            ) : null}
          </>
        ) : null}
      </Screen>

      {editing ? (
        <EditItemSheet
          scanId={id}
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            scan.reload();
          }}
        />
      ) : null}

      {data ? (
        <ConfirmSheet
          open={confirmOpen}
          scan={data}
          acceptedItemIds={[...selected]}
          onClose={() => setConfirmOpen(false)}
          onDone={(resultType, resultId) => {
            setConfirmOpen(false);
            scan.reload();
            if (resultType === 'Purchase' && resultId) navigate(`/purchases/${resultId}`);
          }}
          onEditItem={(itemId) => {
            setConfirmOpen(false);
            const target = data.items.find((entry) => entry.id === itemId);
            if (target) setEditing(target);
          }}
        />
      ) : null}

      <Sheet open={rejectOpen} title="Cancel this scan?" onClose={() => setRejectOpen(false)}>
        <div className="stack">
          <p>Nothing will be added to your stock.</p>
          <TextField label="Reason" value={rejectReason} onChange={setRejectReason} placeholder="Wrong photo, duplicate…" />
          <ErrorNotice error={reject.error} />
          <button type="button" className="btn btn-danger btn-block" disabled={reject.busy} onClick={() => void reject.run()}>
            {reject.busy ? 'Cancelling…' : 'Cancel Scan'}
          </button>
        </div>
      </Sheet>
    </>
  );
}

function ScanItemCard({
  item,
  thresholds,
  checked,
  locked,
  blocked,
  onToggle,
  onEdit,
}: {
  item: ScanItem;
  thresholds: { high: number; medium: number };
  checked: boolean;
  locked: boolean;
  blocked: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const band = item.confidence >= thresholds.high ? '' : item.confidence >= thresholds.medium ? 'medium' : 'low';
  const className = `scan-item${blocked ? ' blocked' : checked ? ' selected' : ''}`;

  return (
    <div className={className}>
      <div className="row">
        {!locked ? (
          <button
            type="button"
            className={checked ? 'checkbox checked' : 'checkbox'}
            aria-label={checked ? 'Do not include' : 'Include'}
            onClick={onToggle}
          >
            ✓
          </button>
        ) : null}
        <div className="grow">
          <strong>{item.matchedProductName ?? item.extractedProductName}</strong>
          <div className="li-sub">
            {item.matchedVariantId ? (
              <>
                Matched from “{item.extractedProductName}” · {item.matchMethod.replace(/_/g, ' ').toLowerCase()}
              </>
            ) : item.createNewProduct ? (
              'Will be created as a new product'
            ) : (
              'No product chosen yet'
            )}
          </div>
        </div>
        <div className="text-right">
          {item.quantity !== null ? (
            <strong style={{ fontSize: '1.15rem' }}>
              {item.quantity > 0 ? '+' : ''}
              {qtyLabel(item.quantity)}
            </strong>
          ) : (
            <Badge tone="red">No quantity</Badge>
          )}
          {item.purchasePricePaise !== null ? <div className="li-sub">{money(item.purchasePricePaise)}</div> : null}
        </div>
      </div>

      <div>
        <div className="row-between" style={{ fontSize: '0.8rem' }}>
          <span className="muted">Confidence</span>
          <span className="muted">{percent(item.confidence)}</span>
        </div>
        <div className={`confidence-bar ${band}`}>
          <span style={{ width: `${Math.round(item.confidence * 100)}%` }} />
        </div>
      </div>

      {item.currentStock !== null ? (
        <div className="li-sub">Now in stock: {qtyLabel(item.currentStock)}</div>
      ) : null}
      {item.batch ? <div className="li-sub">Batch {item.batch}</div> : null}
      {item.expiry ? <div className="li-sub">Expires {dateLabel(item.expiry)}</div> : null}

      {item.issues.length ? (
        <div className="stack-sm">
          {item.issues.map((issue) => (
            <div key={`${issue.field}-${issue.message}`} className={issue.severity === 'BLOCK' ? 'error-text' : 'hint'}>
              {issue.message}
            </div>
          ))}
        </div>
      ) : null}

      {item.userCorrected ? <Badge tone="teal">Edited by you</Badge> : null}

      {!locked ? (
        <div className="row">
          <button type="button" className="btn btn-sm btn-secondary" onClick={onEdit}>
            Edit
          </button>
          {item.matchCandidates.length > 1 ? (
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              {item.matchCandidates.length} possible products
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EditItemSheet({
  scanId,
  item,
  onClose,
  onSaved,
}: {
  scanId: string;
  item: ScanItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const business = useSession((state) => state.business);
  const [productName, setProductName] = useState(item.extractedProductName);
  const [matchedVariantId, setMatchedVariantId] = useState(item.matchedVariantId);
  const [matchedName, setMatchedName] = useState(item.matchedProductName);
  const [createNew, setCreateNew] = useState(item.createNewProduct);
  const [quantity, setQuantity] = useState(item.quantity ?? 0);
  const [purchasePricePaise, setPurchasePricePaise] = useState(item.purchasePricePaise ?? 0);
  const [sellingPricePaise, setSellingPricePaise] = useState(item.sellingPricePaise ?? 0);
  const [mrpPaise, setMrpPaise] = useState(item.mrpPaise ?? 0);
  const [batch, setBatch] = useState(item.batch ?? '');
  const [expiry, setExpiry] = useState(item.expiry ? item.expiry.slice(0, 10) : '');
  const [pickerOpen, setPickerOpen] = useState(false);

  const catalogue = useAsync(() => localSellables(business?.id ?? ''), [business?.id]);

  const save = useSubmit(async () => {
    await api.post(`/scanner/${scanId}/review`, {
      corrections: [
        {
          itemId: item.id,
          productName,
          matchedVariantId: createNew ? null : matchedVariantId,
          createNewProduct: createNew,
          quantity,
          purchasePricePaise: purchasePricePaise || null,
          sellingPricePaise: sellingPricePaise || null,
          mrpPaise: mrpPaise || null,
          batch: batch || null,
          expiry: expiry || null,
          reviewState: 'PENDING',
        },
      ],
    });
    toast.success('Line updated.');
    onSaved();
  });

  return (
    <>
      <Sheet open title="Edit line" onClose={onClose}>
        <div className="stack">
          <Banner tone="info" icon="📄">
            Read from the photo: “{item.extractedProductName}”
            {item.quantity !== null ? `, quantity ${qtyLabel(item.quantity)}` : ''}
          </Banner>

          <button type="button" className="list-item" onClick={() => setPickerOpen(true)}>
            <div className="avatar">📦</div>
            <div className="li-main">
              <div className="li-title">{createNew ? 'New product' : matchedName ?? 'Choose a product'}</div>
              <div className="li-sub">Tap to pick a different product</div>
            </div>
            <span className="chev">›</span>
          </button>

          <button
            type="button"
            className={createNew ? 'chip active' : 'chip'}
            onClick={() => {
              setCreateNew(!createNew);
              if (!createNew) {
                setMatchedVariantId(null);
                setMatchedName(null);
              }
            }}
          >
            {createNew ? '✓ Create as new product' : 'Create as new product'}
          </button>

          <TextField label="Product name" value={productName} onChange={setProductName} />
          <NumberField label="Quantity" value={quantity} onChange={setQuantity} />
          <MoneyField label="Purchase price" valuePaise={purchasePricePaise} onChange={setPurchasePricePaise} />
          <MoneyField label="Selling price" valuePaise={sellingPricePaise} onChange={setSellingPricePaise} />
          <MoneyField label="MRP" valuePaise={mrpPaise} onChange={setMrpPaise} />
          <TextField label="Batch" value={batch} onChange={setBatch} />
          <TextField label="Expiry" value={expiry} onChange={setExpiry} type="date" />

          <ErrorNotice error={save.error} />
          <button type="button" className="btn btn-block btn-lg" disabled={save.busy} onClick={() => void save.run()}>
            {save.busy ? 'Saving…' : 'Save Line'}
          </button>
        </div>
      </Sheet>

      <ProductPicker
        open={pickerOpen}
        items={catalogue.data ?? []}
        suggestions={item.matchCandidates}
        onClose={() => setPickerOpen(false)}
        onPick={(picked) => {
          setMatchedVariantId(picked.variantId);
          setMatchedName(picked.name);
          setCreateNew(false);
          setPickerOpen(false);
        }}
      />
    </>
  );
}

function ProductPicker({
  open,
  items,
  suggestions,
  onClose,
  onPick,
}: {
  open: boolean;
  items: SellableItem[];
  suggestions: Array<{ variantId: string; name: string; score: number; method: string }>;
  onClose: () => void;
  onPick: (item: { variantId: string; name: string }) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = items
    .filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()))
    .slice(0, 60);

  return (
    <Sheet open={open} title="Choose product" onClose={onClose}>
      <div className="stack">
        {suggestions.length ? (
          <>
            <div className="section-heading">Possible matches</div>
            <div className="list">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.variantId}
                  type="button"
                  className="list-item"
                  onClick={() => onPick(suggestion)}
                >
                  <div className="li-main">
                    <div className="li-title">{suggestion.name}</div>
                    <div className="li-sub">{suggestion.method.replace(/_/g, ' ').toLowerCase()}</div>
                  </div>
                  <Badge tone={suggestion.score >= 0.8 ? 'green' : 'amber'}>{percent(suggestion.score)}</Badge>
                </button>
              ))}
            </div>
          </>
        ) : null}

        <input className="input" placeholder="Search your products" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="list">
          {filtered.map((item) => (
            <button key={item.variantId} type="button" className="list-item" onClick={() => onPick(item)}>
              <div className="li-main">
                <div className="li-title">{item.name}</div>
                <div className="li-sub">
                  {qtyLabel(item.stock)} {item.unit.toLowerCase()} · {money(item.sellingPricePaise)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function ConfirmSheet({
  open,
  scan,
  acceptedItemIds,
  onClose,
  onDone,
  onEditItem,
}: {
  open: boolean;
  scan: ScanDetail;
  acceptedItemIds: string[];
  onClose: () => void;
  onDone: (resultType: string | null, resultId: string | null) => void;
  onEditItem: (itemId: string) => void;
}) {
  const isPurchase = scan.scanType === 'INVOICE' || scan.scanType === 'RECEIPT';
  const [supplierId, setSupplierId] = useState<string | null>(scan.supplierId);
  const [supplierName, setSupplierName] = useState(scan.extractedSupplierName ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(scan.invoiceNumber ?? '');
  const [invoiceDate, setInvoiceDate] = useState(scan.invoiceDate ? scan.invoiceDate.slice(0, 10) : '');
  const [payNow, setPayNow] = useState(false);
  const [paidPaise, setPaidPaise] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);

  const total = scan.items
    .filter((item) => acceptedItemIds.includes(item.id))
    .reduce((sum, item) => sum + Math.round((item.quantity ?? 0) * (item.purchasePricePaise ?? 0)), 0);

  const approve = useSubmit(async () => {
    const result = await api.post<{ resultRefType: string | null; resultRefId: string | null }>(
      `/scanner/${scan.id}/approve`,
      {
        acceptedItemIds,
        rejectedItemIds: scan.items.filter((item) => !acceptedItemIds.includes(item.id)).map((item) => item.id),
        ...(isPurchase
          ? {
              supplierId,
              supplierName: supplierId ? null : supplierName || null,
              invoiceNumber: invoiceNumber || null,
              invoiceDate: invoiceDate || null,
              payment: payNow && paidPaise > 0 ? { method: 'CASH' as const, amountPaise: paidPaise } : null,
            }
          : {}),
      },
    );
    toast.success('Confirmed. Your books are updated.');
    onDone(result.resultRefType, result.resultRefId);
  });

  const onErrorAction = (action: ErrorAction) => {
    const itemIds = (action.payload?.itemIds as string[] | undefined) ?? [];
    const itemId = (action.payload?.itemId as string | undefined) ?? itemIds[0];
    if (itemId && (action.action === 'EDIT_ITEMS' || action.action === 'SELECT_PRODUCT' || action.action === 'CREATE_PRODUCT')) {
      onEditItem(itemId);
    }
  };

  return (
    <>
      <Sheet open={open} title={`Confirm ${acceptedItemIds.length} products`} onClose={onClose}>
        <div className="stack">
          {isPurchase ? (
            <>
              <button type="button" className="list-item" onClick={() => setPickerOpen(true)}>
                <div className="avatar">🚚</div>
                <div className="li-main">
                  <div className="li-title">{supplierName || 'Choose supplier'}</div>
                  <div className="li-sub">{supplierId ? 'Existing supplier' : 'Will be created if new'}</div>
                </div>
                <span className="chev">›</span>
              </button>
              <TextField label="Invoice number" value={invoiceNumber} onChange={setInvoiceNumber} />
              <TextField label="Invoice date" value={invoiceDate} onChange={setInvoiceDate} type="date" />
              <div className="card">
                <div className="row-between">
                  <span>Goods value</span>
                  <strong>{money(total)}</strong>
                </div>
              </div>
              <button type="button" className={payNow ? 'chip active' : 'chip'} onClick={() => setPayNow(!payNow)}>
                {payNow ? '✓ Paying now' : 'Paying now?'}
              </button>
              {payNow ? <MoneyField label="Amount paid" valuePaise={paidPaise} onChange={setPaidPaise} /> : null}
            </>
          ) : (
            <Banner tone="info" icon="ℹ️">
              {scan.scanType === 'PRODUCT'
                ? 'Only product details will be updated. Stock will not change.'
                : 'This will be recorded as a counted stock difference, with a reason of physical count.'}
            </Banner>
          )}

          <ErrorNotice error={approve.error} onAction={onErrorAction} />

          <button type="button" className="btn btn-block btn-lg" disabled={approve.busy} onClick={() => void approve.run()}>
            {approve.busy ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </Sheet>

      <CustomerPicker
        open={pickerOpen}
        kind="SUPPLIER"
        title="Choose supplier"
        onClose={() => setPickerOpen(false)}
        onPick={(party) => {
          setSupplierId(party?.id ?? null);
          setSupplierName(party?.name ?? '');
          setPickerOpen(false);
        }}
      />
    </>
  );
}
