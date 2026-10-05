import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../../components/AppShell';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { Badge, ChipRow, Empty, ErrorNotice, ListRow, Loading, Screen } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { money, quantity as qtyLabel } from '../../lib/format';
import { useSession } from '../../store/session';

interface ProductListVariant {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  sellingPricePaise: number;
  mrpPaise: number;
  minStock: number;
  stock: number;
}

interface ProductListRow {
  id: string;
  name: string;
  category: string | null;
  brand: string | null;
  unit: string;
  hasVariants: boolean;
  totalStock: number;
  variants: ProductListVariant[];
}

interface ProductListResponse {
  items: ProductListRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface CategoryRow {
  id: string;
  name: string;
}

/** Everything the shop sells, searchable by name, SKU or barcode. */
export function ProductList() {
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [missedScan, setMissedScan] = useState<{ code: string; error: Error } | null>(null);

  const categories = useAsync(() => api.get<{ categories: CategoryRow[] }>('/business/categories'), []);
  const products = useAsync(
    () =>
      api.get<ProductListResponse>('/products', {
        search: search.trim() || undefined,
        categoryId: categoryId || undefined,
        pageSize: 100,
      }),
    [search, categoryId],
  );

  const onBarcode = async (code: string) => {
    setScannerOpen(false);
    setMissedScan(null);
    try {
      const found = await api.get<{ product: { productId: string } }>(`/products/barcode/${encodeURIComponent(code)}`);
      navigate(`/products/${found.product.productId}`);
    } catch (cause) {
      setMissedScan({ code, error: cause instanceof Error ? cause : new Error('Something went wrong.') });
    }
  };

  const items = products.data?.items ?? [];
  const filtered = Boolean(search.trim() || categoryId);

  return (
    <>
      <TopBar
        title="Products"
        back
        subtitle={products.data ? `${products.data.total} ${filtered ? 'found' : 'in your shop'}` : undefined}
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
      </div>

      <Screen>
        {missedScan ? (
          <ErrorNotice
            error={missedScan.error}
            onAction={(action) => {
              if (action.action === 'CREATE_PRODUCT') {
                navigate(`/products/new?barcode=${encodeURIComponent(missedScan.code)}`);
                return;
              }
              if (action.action === 'SEARCH_PRODUCT') {
                setSearch(missedScan.code);
                setMissedScan(null);
              }
            }}
          />
        ) : null}

        <ChipRow
          value={categoryId}
          onChange={setCategoryId}
          options={[
            { value: '', label: 'All' },
            ...(categories.data?.categories ?? []).map((category) => ({ value: category.id, label: category.name })),
          ]}
        />

        {can('product:write') ? (
          <button type="button" className="btn btn-block" onClick={() => navigate('/products/new')}>
            Add Product
          </button>
        ) : null}

        <ErrorNotice error={products.error} onRetry={products.reload} />
        {products.loading && !products.data ? <Loading /> : null}

        {products.data && !items.length ? (
          <Empty
            icon="📦"
            title={filtered ? 'No product matches' : 'No products yet'}
            hint={
              filtered
                ? 'Try a shorter word, or clear the filter.'
                : 'Add your first product with its price and opening stock.'
            }
            action={
              can('product:write') ? (
                <button type="button" className="btn" onClick={() => navigate('/products/new')}>
                  Add Product
                </button>
              ) : null
            }
          />
        ) : null}

        {items.length ? (
          <div className="list">
            {items.map((product) => (
              <ListRow
                key={product.id}
                title={product.name}
                subtitle={subtitleFor(product)}
                amount={money(priceOf(product))}
                note={
                  product.totalStock > 0 ? (
                    `${qtyLabel(product.totalStock)} ${product.unit.toLowerCase()}`
                  ) : (
                    <Badge tone="red">Out of stock</Badge>
                  )
                }
                onClick={() => navigate(`/products/${product.id}`)}
              />
            ))}
          </div>
        ) : null}
      </Screen>

      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={(code) => void onBarcode(code)} />
    </>
  );
}

/** The default variant is the oldest one, which is what the list returns first. */
const priceOf = (product: ProductListRow): number => product.variants[0]?.sellingPricePaise ?? 0;

function subtitleFor(product: ProductListRow): string {
  const parts = [product.category ?? 'Uncategorised'];
  if (product.brand) parts.push(product.brand);
  if (product.variants.length > 1) parts.push(`${product.variants.length} variants`);
  return parts.join(' · ');
}
