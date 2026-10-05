import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../components/AppShell';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { Banner, Empty, Loading, NumberField, Screen, Sheet, TextField } from '../components/ui';
import { Checkout } from '../screens/sell/Checkout';
import { useAsync } from '../hooks/useAsync';
import { localSellables } from '../lib/sync';
import { money, quantity as qtyLabel } from '../lib/format';
import { toast } from '../lib/toast';
import { cartTotals, useCart } from '../store/cart';
import { useSession } from '../store/session';
import type { SellableItem } from '../lib/types';

/**
 * The counter screen. Everything is served from the phone's own copy of the
 * catalogue, so billing never waits for the network - and never stops when it
 * disappears.
 */
export function Sell() {
  const navigate = useNavigate();
  const business = useSession((state) => state.business);
  const settings = useSession((state) => state.settings);
  const connection = useSession((state) => state.connection);

  const [search, setSearch] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [pendingItem, setPendingItem] = useState<SellableItem | null>(null);

  const cart = useCart();
  const catalogue = useAsync(() => localSellables(business?.id ?? ''), [business?.id, connection]);
  const items = useMemo(() => catalogue.data ?? [], [catalogue.data]);

  const totals = cartTotals(cart.lines, cart.billDiscountPaise, {
    taxEnabled: settings?.taxEnabled ?? false,
    pricesIncludeTax: settings?.pricesIncludeTax ?? true,
    roundOff: settings?.roundOffSaleTotal ?? false,
  });

  const results = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items.slice(0, 40);
    return items
      .filter(
        (item) =>
          item.name.toLowerCase().includes(term) ||
          item.sku.toLowerCase().includes(term) ||
          (item.barcode ?? '').includes(term),
      )
      .slice(0, 40);
  }, [items, search]);

  const addItem = (item: SellableItem) => {
    if (item.allowDecimal || item.trackSerial) {
      setPendingItem(item);
      return;
    }
    cart.add(item, 1);
    setSearch('');
  };

  const onBarcode = (code: string) => {
    setScannerOpen(false);
    const found = items.find((item) => item.barcode === code || item.sku === code);
    if (!found) {
      toast.warning('This barcode is not in your shop yet.');
      setSearch(code);
      return;
    }
    addItem(found);
  };

  useEffect(() => {
    if (!cart.lines.length) setCheckoutOpen(false);
  }, [cart.lines.length]);

  return (
    <>
      <TopBar
        title="Sell"
        subtitle={cart.lines.length ? `${cart.lines.length} in bill` : 'Scan or search a product'}
        actions={
          <button type="button" className="icon-button" aria-label="Scan barcode" onClick={() => setScannerOpen(true)}>
            📷
          </button>
        }
      />

      <div className="pos-search">
        <input
          className="input"
          placeholder="Search product, SKU or barcode"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="button" className="btn btn-secondary" onClick={() => setScannerOpen(true)}>
          Scan
        </button>
      </div>

      {catalogue.loading ? <Loading label="Opening your catalogue…" /> : null}

      {!catalogue.loading && !items.length ? (
        <Screen>
          <Empty
            icon="📦"
            title="No products yet"
            hint="Add your first product and its opening stock to start billing."
            action={
              <button type="button" className="btn" onClick={() => navigate('/products/new')}>
                Add Product
              </button>
            }
          />
        </Screen>
      ) : null}

      {cart.lines.length ? (
        <div className="screen" style={{ paddingBottom: 0 }}>
          <div className="card card-flush">
            {cart.lines.map((line) => (
              <div className="cart-line" key={line.variantId}>
                <div className="cart-line-top">
                  <div className="grow">
                    <strong>{line.name}</strong>
                    <div className="li-sub">
                      {money(line.unitPricePaise)} / {line.unit.toLowerCase()}
                      {line.quantity > line.stock ? ` · only ${qtyLabel(line.stock)} in stock` : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <strong>{money(Math.round(line.unitPricePaise * line.quantity) - line.discountPaise)}</strong>
                  </div>
                </div>
                <div className="row">
                  <div className="stepper">
                    <button
                      type="button"
                      aria-label="Less"
                      onClick={() => cart.setQuantity(line.variantId, Number((line.quantity - (line.allowDecimal ? 0.5 : 1)).toFixed(3)))}
                    >
                      −
                    </button>
                    <input
                      inputMode={line.allowDecimal ? 'decimal' : 'numeric'}
                      value={line.quantity}
                      onChange={(event) => cart.setQuantity(line.variantId, Number(event.target.value.replace(/[^\d.]/g, '') || 0))}
                    />
                    <button
                      type="button"
                      aria-label="More"
                      onClick={() => cart.setQuantity(line.variantId, Number((line.quantity + (line.allowDecimal ? 0.5 : 1)).toFixed(3)))}
                    >
                      +
                    </button>
                  </div>
                  <button type="button" className="btn btn-ghost" onClick={() => cart.remove(line.variantId)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => cart.clear()}>
            Clear bill
          </button>
        </div>
      ) : null}

      <div className="pos-results" style={{ paddingTop: 12, paddingBottom: cart.lines.length ? 120 : 24 }}>
        {results.map((item) => (
          <button
            key={item.variantId}
            type="button"
            className="pos-result"
            onClick={() => addItem(item)}
            disabled={item.stock <= 0 && !(settings?.allowNegativeStock ?? false)}
          >
            <div className="grow">
              <div className="li-title">{item.name}</div>
              <div className="li-sub">
                {item.stock <= 0 ? 'Out of stock' : `${qtyLabel(item.stock)} ${item.unit.toLowerCase()} in stock`}
              </div>
            </div>
            <div className="text-right">
              <div className="li-amount">{money(item.sellingPricePaise)}</div>
            </div>
          </button>
        ))}
        {search && !results.length ? (
          <Empty
            icon="🔍"
            title="No product matches"
            hint="Create it, or check the spelling."
            action={
              <button type="button" className="btn btn-sm" onClick={() => navigate('/products/new')}>
                Create Product
              </button>
            }
          />
        ) : null}
      </div>

      {cart.lines.length ? (
        <div className="bill-bar">
          <div className="bill-total">
            <div className="label">Total</div>
            <div className="amount">{money(totals.totalPaise)}</div>
          </div>
          <button type="button" className="btn btn-lg" onClick={() => setCheckoutOpen(true)}>
            Charge
          </button>
        </div>
      ) : null}

      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={onBarcode} />

      <QuantitySheet
        item={pendingItem}
        onClose={() => setPendingItem(null)}
        onConfirm={(item, amount, serials) => {
          cart.add(item, amount);
          if (serials.length) cart.setSerials(item.variantId, serials);
          setPendingItem(null);
          setSearch('');
        }}
      />

      <Checkout open={checkoutOpen} totals={totals} onClose={() => setCheckoutOpen(false)} onDone={() => setCheckoutOpen(false)} />
    </>
  );
}

function QuantitySheet({
  item,
  onClose,
  onConfirm,
}: {
  item: SellableItem | null;
  onClose: () => void;
  onConfirm: (item: SellableItem, quantity: number, serials: string[]) => void;
}) {
  const [amount, setAmount] = useState(1);
  const [serials, setSerials] = useState('');

  useEffect(() => {
    setAmount(1);
    setSerials('');
  }, [item?.variantId]);

  if (!item) return null;
  const serialList = serials
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const serialsNeeded = item.trackSerial ? Math.round(amount) : 0;

  return (
    <Sheet open title={item.name} onClose={onClose}>
      <div className="stack">
        <NumberField
          label={`Quantity (${item.unit.toLowerCase()})`}
          value={amount}
          onChange={setAmount}
          allowDecimal={item.allowDecimal}
          autoFocus
        />
        {item.trackSerial ? (
          <TextField
            label="Serial / IMEI numbers"
            value={serials}
            onChange={setSerials}
            hint="One per line. These are matched against the pieces in stock."
          />
        ) : null}
        {amount > item.stock ? (
          <Banner tone="warning" icon="⚠️">
            Only {qtyLabel(item.stock)} {item.unit.toLowerCase()} in stock.
          </Banner>
        ) : null}
        {serialsNeeded > 0 && serialList.length !== serialsNeeded ? (
          <Banner tone="warning" icon="🔢">
            Enter {serialsNeeded} serial {serialsNeeded === 1 ? 'number' : 'numbers'}.
          </Banner>
        ) : null}
        <button
          type="button"
          className="btn btn-block btn-lg"
          disabled={amount <= 0 || (serialsNeeded > 0 && serialList.length !== serialsNeeded)}
          onClick={() => onConfirm(item, amount, serialList)}
        >
          Add {money(Math.round(item.sellingPricePaise * amount))}
        </button>
      </div>
    </Sheet>
  );
}
