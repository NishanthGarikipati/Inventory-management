import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '../components/AppShell';
import {
  Banner,
  Card,
  ErrorNotice,
  Loading,
  NumberField,
  Screen,
  SelectField,
  Sheet,
  StatTile,
  TextAreaField,
} from '../components/ui';
import { statusBadge } from './Stock';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { ApiError, api, newRequestId } from '../lib/api';
import { applyLocalStockDelta, queueOperation } from '../lib/sync';
import { dateLabel, dateTimeLabel, money, quantity as qtyLabel } from '../lib/format';
import { toast } from '../lib/toast';
import { useSession } from '../store/session';
import type { InventoryRow } from '../lib/types';

interface LedgerRow {
  id: string;
  type: string;
  quantity: number;
  previousStock: number;
  newStock: number;
  note: string | null;
  source: string;
  createdAt: string;
  user: { id: string; name: string } | null;
}

interface BatchRow {
  id: string;
  batchNumber: string | null;
  quantity: number;
  expiryDate: string | null;
  costPaise: number;
}

const REASONS = [
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'LOST', label: 'Lost / stolen' },
  { value: 'PERSONAL_USE', label: 'Personal use' },
  { value: 'COUNT_DIFF', label: 'Physical count difference' },
  { value: 'OPENING', label: 'Opening stock' },
  { value: 'OTHER', label: 'Other' },
] as const;

type Reason = (typeof REASONS)[number]['value'];

const MOVEMENT_LABEL: Record<string, string> = {
  OPENING: 'Opening stock',
  PURCHASE: 'Purchase',
  SALE: 'Sale',
  SALE_RETURN: 'Sale return',
  PURCHASE_RETURN: 'Purchase return',
  ADJUSTMENT: 'Adjustment',
  DAMAGE: 'Damage',
  EXPIRY: 'Expiry',
  TRANSFER: 'Transfer',
  PRODUCTION: 'Production',
  CONSUMPTION: 'Used in recipe',
  IMAGE_SCAN_ADJUSTMENT: 'From scanned photo',
};

/** One product's stock card: level, value, movement history and adjustment. */
export function StockItem() {
  const { variantId = '' } = useParams();
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const item = useAsync(() => api.get<{ item: InventoryRow }>(`/inventory/item/${variantId}`), [variantId]);
  const ledger = useAsync(() => api.get<{ transactions: LedgerRow[] }>(`/inventory/ledger/${variantId}`, { limit: 50 }), [
    variantId,
  ]);
  const batches = useAsync(() => api.get<{ batches: BatchRow[] }>(`/inventory/batches/${variantId}`), [variantId]);

  const row = item.data?.item;

  return (
    <>
      <TopBar title={row?.name ?? 'Product'} subtitle={row?.sku} back />
      <Screen>
        <ErrorNotice error={item.error} onRetry={item.reload} />
        {item.loading && !row ? <Loading /> : null}

        {row ? (
          <>
            <div className="stat-grid">
              <StatTile
                label="In stock"
                value={`${qtyLabel(row.quantity)} ${row.unit.toLowerCase()}`}
                note={row.minStock ? `Minimum ${qtyLabel(row.minStock)}` : undefined}
                accent
              />
              <StatTile label="Stock value" value={money(row.stockValuePaise)} note="At average cost" />
            </div>

            <div className="row">{statusBadge(row.status)}</div>

            <Card title="Prices">
              <div className="row-between">
                <span>Selling price</span>
                <strong>{money(row.sellingPricePaise)}</strong>
              </div>
              <div className="row-between" style={{ marginTop: 8 }}>
                <span>Average cost</span>
                <strong>{money(row.avgCostPaise)}</strong>
              </div>
              <div className="row-between" style={{ marginTop: 8 }}>
                <span>MRP</span>
                <strong>{money(row.mrpPaise)}</strong>
              </div>
            </Card>

            <div className="row">
              {can('inventory:adjust') ? (
                <button type="button" className="btn grow" onClick={() => setAdjustOpen(true)}>
                  Adjust Stock
                </button>
              ) : null}
              <button type="button" className="btn btn-secondary grow" onClick={() => navigate(`/products/${row.productId}`)}>
                Product
              </button>
            </div>

            {batches.data?.batches.length ? (
              <Card title="Batches" flush>
                <div className="list">
                  {batches.data.batches.map((batch) => (
                    <div className="list-item" key={batch.id}>
                      <div className="li-main">
                        <div className="li-title">{batch.batchNumber ?? 'No batch number'}</div>
                        <div className="li-sub">
                          {batch.expiryDate ? `Expires ${dateLabel(batch.expiryDate)}` : 'No expiry'}
                        </div>
                      </div>
                      <div className="li-right">
                        <div className="li-amount">{qtyLabel(batch.quantity)}</div>
                        <div className="li-sub">{money(batch.costPaise)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}

            <Card title="Stock movement" flush>
              {ledger.loading ? <Loading /> : null}
              <div className="list">
                {(ledger.data?.transactions ?? []).map((entry) => (
                  <div className="list-item" key={entry.id}>
                    <div className="li-main">
                      <div className="li-title">{MOVEMENT_LABEL[entry.type] ?? entry.type}</div>
                      <div className="li-sub">
                        {dateTimeLabel(entry.createdAt)}
                        {entry.user ? ` · ${entry.user.name}` : ''}
                        {entry.source === 'IMAGE_SCAN' ? ' · from photo' : ''}
                      </div>
                    </div>
                    <div className="li-right">
                      <div className="li-amount" style={{ color: entry.quantity >= 0 ? 'var(--green-700)' : 'var(--red-700)' }}>
                        {entry.quantity >= 0 ? '+' : ''}
                        {qtyLabel(entry.quantity)}
                      </div>
                      <div className="li-sub">{qtyLabel(entry.newStock)} left</div>
                    </div>
                  </div>
                ))}
                {!ledger.loading && !ledger.data?.transactions.length ? (
                  <div style={{ padding: 16 }} className="muted">
                    No movement yet.
                  </div>
                ) : null}
              </div>
            </Card>
          </>
        ) : null}
      </Screen>

      {row ? (
        <AdjustSheet
          open={adjustOpen}
          row={row}
          onClose={() => setAdjustOpen(false)}
          onSaved={() => {
            setAdjustOpen(false);
            item.reload();
            ledger.reload();
          }}
        />
      ) : null}
    </>
  );
}

function AdjustSheet({
  open,
  row,
  onClose,
  onSaved,
}: {
  open: boolean;
  row: InventoryRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const business = useSession((state) => state.business);
  const refreshPending = useSession((state) => state.refreshPending);
  const [mode, setMode] = useState<'CHANGE' | 'COUNT'>('CHANGE');
  const [reason, setReason] = useState<Reason>('COUNT_DIFF');
  const [change, setChange] = useState(0);
  const [counted, setCounted] = useState(row.quantity);
  const [note, setNote] = useState('');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT');

  const delta = mode === 'COUNT' ? Number((counted - row.quantity).toFixed(3)) : direction === 'IN' ? change : -change;

  const { run, busy, error } = useSubmit(async () => {
    const clientRequestId = newRequestId();
    const payload = {
      reason,
      note: note || undefined,
      clientRequestId,
      lines: [
        mode === 'COUNT'
          ? { variantId: row.variantId, countedQuantity: counted }
          : { variantId: row.variantId, quantityChange: delta },
      ],
    };

    const queueIt = async () => {
      await queueOperation({
        clientRequestId,
        businessId: business?.id ?? '',
        type: 'ADJUSTMENT',
        payload,
        summary: `Stock update · ${row.name}`,
      });
      await applyLocalStockDelta(business?.id ?? '', [{ variantId: row.variantId, change: delta }]);
      await refreshPending();
      toast.info('Saved on this phone. It will be sent when you are online.');
      onSaved();
    };

    if (!navigator.onLine) {
      await queueIt();
      return;
    }

    try {
      await api.post('/inventory/adjustment', payload, clientRequestId);
      await applyLocalStockDelta(business?.id ?? '', [{ variantId: row.variantId, change: delta }]);
      toast.success('Stock updated.');
      onSaved();
    } catch (cause) {
      if (cause instanceof ApiError && cause.isOffline) {
        await queueIt();
        return;
      }
      throw cause;
    }
  });

  return (
    <Sheet open={open} title="Adjust stock" onClose={onClose}>
      <div className="stack">
        <div className="chip-row">
          <button type="button" className={mode === 'CHANGE' ? 'chip active' : 'chip'} onClick={() => setMode('CHANGE')}>
            Add or remove
          </button>
          <button type="button" className={mode === 'COUNT' ? 'chip active' : 'chip'} onClick={() => setMode('COUNT')}>
            Counted on shelf
          </button>
        </div>

        {mode === 'CHANGE' ? (
          <>
            <div className="chip-row">
              <button type="button" className={direction === 'IN' ? 'chip active' : 'chip'} onClick={() => setDirection('IN')}>
                Add stock
              </button>
              <button type="button" className={direction === 'OUT' ? 'chip active' : 'chip'} onClick={() => setDirection('OUT')}>
                Remove stock
              </button>
            </div>
            <NumberField
              label={`Quantity (${row.unit.toLowerCase()})`}
              value={change}
              onChange={setChange}
              allowDecimal={row.allowDecimal}
              autoFocus
            />
          </>
        ) : (
          <NumberField
            label={`Counted quantity (${row.unit.toLowerCase()})`}
            value={counted}
            onChange={setCounted}
            allowDecimal={row.allowDecimal}
            autoFocus
          />
        )}

        <SelectField
          label="Reason"
          value={reason}
          onChange={(value) => setReason(value)}
          options={REASONS.map((entry) => ({ value: entry.value, label: entry.label }))}
        />
        <TextAreaField label="Note (optional)" value={note} onChange={setNote} />

        <Banner tone={delta === 0 ? 'info' : 'warning'} icon="📦">
          {delta === 0
            ? 'Nothing will change.'
            : `Stock will go from ${qtyLabel(row.quantity)} to ${qtyLabel(row.quantity + delta)} ${row.unit.toLowerCase()}.`}
        </Banner>

        <ErrorNotice error={error} />

        <button type="button" className="btn btn-block btn-lg" disabled={busy || delta === 0} onClick={() => void run()}>
          {busy ? 'Saving…' : 'Confirm'}
        </button>
      </div>
    </Sheet>
  );
}
