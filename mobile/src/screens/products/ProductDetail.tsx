import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '../../components/AppShell';
import {
  Badge,
  Banner,
  Card,
  ConfirmSheet,
  ErrorNotice,
  Loading,
  Screen,
  StatTile,
} from '../../components/ui';
import { useAsync, useSubmit } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { dateLabel, money, quantity as qtyLabel } from '../../lib/format';
import { toast } from '../../lib/toast';
import { useSession } from '../../store/session';

interface VariantRow {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  purchasePricePaise: number;
  sellingPricePaise: number;
  mrpPaise: number;
  minStock: number;
  isDefault: boolean;
  inventory: { quantity: number; avgCostPaise: number } | null;
}

interface AttributeValueRow {
  id: string;
  value: string;
  definition: { key: string; label: string; dataType: string };
}

interface ProductResponse {
  id: string;
  name: string;
  description: string | null;
  hasVariants: boolean;
  trackBatch: boolean;
  trackExpiry: boolean;
  trackSerial: boolean;
  isComposite: boolean;
  isActive: boolean;
  category: { id: string; name: string } | null;
  brand: { id: string; name: string } | null;
  unit: { code: string; name: string };
  tax: { id: string; name: string; rate: number } | null;
  variants: VariantRow[];
  attributeValues: AttributeValueRow[];
  totalStock: number;
}

/** One product's card: what it is, what it costs and what is on the shelf. */
export function ProductDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const settings = useSession((state) => state.settings);
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  const product = useAsync(() => api.get<ProductResponse>(`/products/${id}`), [id]);
  const data = product.data;
  const defaultVariant = data?.variants.find((variant) => variant.isDefault) ?? data?.variants[0];
  const filledAttributes = (data?.attributeValues ?? []).filter((row) => row.value !== '');

  const deactivate = useSubmit(async () => {
    await api.del(`/products/${id}`);
    toast.success('Product switched off. It will not show while billing.');
    setDeactivateOpen(false);
    product.reload();
  });

  const reactivate = useSubmit(async () => {
    await api.put(`/products/${id}`, { isActive: true });
    toast.success('Product is back in billing.');
    product.reload();
  });

  return (
    <>
      <TopBar title={data?.name ?? 'Product'} back subtitle={data ? subtitleFor(data) : undefined} />
      <Screen>
        <ErrorNotice error={product.error} onRetry={product.reload} />
        {product.loading && !data ? <Loading /> : null}

        {data ? (
          <>
            {!data.isActive ? (
              <Banner
                tone="warning"
                icon="🚫"
                actions={
                  can('product:write') ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      disabled={reactivate.busy}
                      onClick={() => void reactivate.run()}
                    >
                      Turn Back On
                    </button>
                  ) : null
                }
              >
                This product is switched off. It is hidden from billing, but its history is safe.
              </Banner>
            ) : null}

            <div className="stat-grid">
              <StatTile
                label="In stock"
                value={`${qtyLabel(data.totalStock)} ${data.unit.code.toLowerCase()}`}
                note={data.variants.length > 1 ? `Across ${data.variants.length} variants` : undefined}
                accent
              />
              <StatTile
                label="Selling price"
                value={money(defaultVariant?.sellingPricePaise ?? 0)}
                note={defaultVariant?.mrpPaise ? `MRP ${money(defaultVariant.mrpPaise)}` : undefined}
              />
            </div>

            {data.trackBatch || data.trackExpiry || data.trackSerial || data.isComposite ? (
              <div className="chip-row">
                {data.trackBatch ? <Badge tone="blue">Batches</Badge> : null}
                {data.trackExpiry ? <Badge tone="amber">Expiry</Badge> : null}
                {data.trackSerial ? <Badge tone="teal">Serial / IMEI</Badge> : null}
                {data.isComposite ? <Badge tone="grey">Made from a recipe</Badge> : null}
              </div>
            ) : null}

            <Card title="Details">
              <DetailRow label="Category" value={data.category?.name ?? 'Not set'} />
              <DetailRow label="Brand" value={data.brand?.name ?? 'Not set'} />
              <DetailRow label="Sold by" value={`${data.unit.name} (${data.unit.code})`} />
              {settings?.taxEnabled ? (
                <DetailRow
                  label={settings.taxLabel || 'Tax'}
                  value={data.tax ? `${data.tax.name} · ${data.tax.rate}%` : 'No tax'}
                />
              ) : null}
              {data.description ? <DetailRow label="Note" value={data.description} /> : null}
            </Card>

            {filledAttributes.length ? (
              <Card title="Custom details">
                {filledAttributes.map((row) => (
                  <DetailRow key={row.id} label={row.definition.label} value={attributeText(row)} />
                ))}
              </Card>
            ) : null}

            <Card title="Prices">
              <DetailRow label="Selling price" value={money(defaultVariant?.sellingPricePaise ?? 0)} />
              <DetailRow label="Purchase price" value={money(defaultVariant?.purchasePricePaise ?? 0)} />
              <DetailRow label="MRP" value={money(defaultVariant?.mrpPaise ?? 0)} />
            </Card>

            <Card title={data.variants.length > 1 ? 'Variants' : 'Stock'} flush>
              <div className="list">
                {data.variants.map((variant) => (
                  <button
                    key={variant.id}
                    type="button"
                    className="list-item"
                    onClick={() => navigate(`/stock/${variant.id}`)}
                  >
                    <div className="li-main">
                      <div className="li-title">{variant.isDefault && data.variants.length === 1 ? data.name : variant.name}</div>
                      <div className="li-sub">
                        {variant.sku}
                        {variant.barcode ? ` · ${variant.barcode}` : ' · no barcode'}
                      </div>
                    </div>
                    <div className="li-right">
                      <div className="li-amount">
                        {qtyLabel(variant.inventory?.quantity ?? 0)} <span className="muted">{data.unit.code.toLowerCase()}</span>
                      </div>
                      <div className="li-sub">{money(variant.sellingPricePaise)}</div>
                    </div>
                  </button>
                ))}
              </div>
            </Card>

            <div className="row">
              {can('product:write') ? (
                <button type="button" className="btn grow" onClick={() => navigate(`/products/${data.id}/edit`)}>
                  Edit
                </button>
              ) : null}
              {defaultVariant ? (
                <button
                  type="button"
                  className="btn btn-secondary grow"
                  onClick={() => navigate(`/stock/${defaultVariant.id}`)}
                >
                  View Stock
                </button>
              ) : null}
            </div>

            {can('product:delete') && data.isActive ? (
              <button type="button" className="btn btn-danger btn-block" onClick={() => setDeactivateOpen(true)}>
                Deactivate
              </button>
            ) : null}

            <ErrorNotice error={deactivate.error} />
            <ErrorNotice error={reactivate.error} />
          </>
        ) : null}
      </Screen>

      <ConfirmSheet
        open={deactivateOpen}
        title="Switch off this product?"
        message="It stops showing while billing and in search. Old bills, purchases and stock history stay exactly as they are, and you can turn it back on any time."
        confirmLabel="Deactivate"
        danger
        busy={deactivate.busy}
        onConfirm={() => void deactivate.run()}
        onCancel={() => setDeactivateOpen(false)}
      />
    </>
  );
}

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <div className="row-between" style={{ padding: '6px 0' }}>
    <span className="muted">{label}</span>
    <strong className="text-right">{value}</strong>
  </div>
);

function subtitleFor(product: ProductResponse): string {
  const parts = [product.category?.name ?? 'Uncategorised'];
  if (product.brand) parts.push(product.brand.name);
  return parts.join(' · ');
}

function attributeText(row: AttributeValueRow): string {
  if (row.definition.dataType === 'BOOLEAN') return row.value === 'true' ? 'Yes' : 'No';
  if (row.definition.dataType === 'DATE') return dateLabel(row.value);
  return row.value;
}
