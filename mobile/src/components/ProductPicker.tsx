import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarcodeScanner } from './BarcodeScanner';
import { Empty, ErrorNotice, Loading, Sheet } from './ui';
import { useAsync } from '../hooks/useAsync';
import { ApiError, api } from '../lib/api';
import { db } from '../lib/db';
import { money, quantity as qtyLabel } from '../lib/format';
import { useSession } from '../store/session';
import type { InventoryRow } from '../lib/types';

/** A product the purchase and return screens can add without leaving the form. */
export interface PickedProduct {
  variantId: string;
  name: string;
  unit: string;
  allowDecimal: boolean;
  trackBatch: boolean;
  purchasePricePaise: number;
  sellingPricePaise: number;
  stock: number;
}

interface InventoryResponse {
  items: InventoryRow[];
}

/**
 * Search or scan a product. The catalogue on the phone is used when the shop
 * is offline, so a purchase can still be written down.
 */
export function ProductPicker({
  open,
  title = 'Add product',
  onClose,
  onPick,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  onPick: (product: PickedProduct) => void;
}) {
  const navigate = useNavigate();
  const business = useSession((state) => state.business);
  const [search, setSearch] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState<Error | null>(null);

  const results = useAsync(async () => {
    if (!open) return [] as PickedProduct[];
    const query = search.trim();
    if (navigator.onLine) {
      try {
        const response = await api.get<InventoryResponse>('/inventory', {
          search: query || undefined,
          pageSize: 40,
        });
        return response.items.map(toPicked);
      } catch (cause) {
        if (!(cause instanceof ApiError) || !cause.isOffline) throw cause;
      }
    }
    return searchLocal(business?.id ?? '', query);
  }, [open, search, business?.id]);

  const onBarcode = async (code: string) => {
    setScannerOpen(false);
    setScanError(null);
    setSearch(code);
    try {
      const response = await api.get<InventoryResponse>('/inventory', { search: code, pageSize: 5 });
      const match = response.items.find((item) => item.barcode === code) ?? response.items[0];
      if (!match) {
        setScanError(new Error('This barcode is not in your shop yet.'));
        return;
      }
      onPick(toPicked(match));
      setSearch('');
    } catch (cause) {
      setScanError(cause instanceof Error ? cause : new Error('The barcode could not be read.'));
    }
  };

  return (
    <>
      <Sheet open={open} title={title} onClose={onClose}>
        <div className="stack">
          <div className="row">
            <input
              className="input grow"
              placeholder="Name, SKU or barcode"
              value={search}
              autoFocus
              onChange={(event) => setSearch(event.target.value)}
            />
            <button type="button" className="btn btn-secondary" onClick={() => setScannerOpen(true)}>
              Scan
            </button>
          </div>
          <ErrorNotice
            error={scanError ?? results.error}
            onAction={(action) => {
              if (action.action === 'CREATE_PRODUCT') navigate('/products/new');
            }}
          />
          {results.loading ? <Loading label="Looking through products…" /> : null}
          {!results.loading && !(results.data ?? []).length ? (
            <Empty
              icon="🔎"
              title="No product found"
              hint="Try another name, or add the product first."
              action={
                <button type="button" className="btn" onClick={() => navigate('/products/new')}>
                  Add Product
                </button>
              }
            />
          ) : null}
          <div className="list">
            {(results.data ?? []).map((item) => (
              <button
                key={item.variantId}
                type="button"
                className="list-item"
                onClick={() => {
                  onPick(item);
                  setSearch('');
                }}
              >
                <div className="li-main">
                  <div className="li-title">{item.name}</div>
                  <div className="li-sub">
                    {qtyLabel(item.stock)} {item.unit.toLowerCase()} in stock · buy {money(item.purchasePricePaise)}
                  </div>
                </div>
                <span className="chev">＋</span>
              </button>
            ))}
          </div>
        </div>
      </Sheet>
      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={(code) => void onBarcode(code)} />
    </>
  );
}

function toPicked(item: InventoryRow): PickedProduct {
  return {
    variantId: item.variantId,
    name: item.name,
    unit: item.unit,
    allowDecimal: item.allowDecimal,
    trackBatch: item.trackBatch,
    purchasePricePaise: item.purchasePricePaise,
    sellingPricePaise: item.sellingPricePaise,
    stock: item.quantity,
  };
}

async function searchLocal(businessId: string, query: string): Promise<PickedProduct[]> {
  if (!businessId) return [];
  const [products, stock] = await Promise.all([
    db.products.where('businessId').equals(businessId).toArray(),
    db.stock.where('businessId').equals(businessId).toArray(),
  ]);
  const stockByVariant = new Map(stock.map((row) => [row.variantId, row.quantity]));
  const needle = query.toLowerCase();
  const rows: PickedProduct[] = [];
  for (const product of products) {
    if (!product.isActive) continue;
    for (const variant of product.variants) {
      const name = variant.isDefault ? product.name : `${product.name} - ${variant.name}`;
      const haystack = `${name} ${variant.sku} ${variant.barcode ?? ''}`.toLowerCase();
      if (needle && !haystack.includes(needle) && variant.barcode !== query) continue;
      rows.push({
        variantId: variant.id,
        name,
        unit: product.unit,
        allowDecimal: product.allowDecimal,
        trackBatch: product.trackBatch,
        purchasePricePaise: variant.purchasePricePaise,
        sellingPricePaise: variant.sellingPricePaise,
        stock: stockByVariant.get(variant.id) ?? 0,
      });
    }
  }
  return rows.slice(0, 40);
}
