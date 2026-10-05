import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { TopBar } from '../../components/AppShell';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import {
  Banner,
  Card,
  Empty,
  ErrorNotice,
  Loading,
  MoneyField,
  NumberField,
  Screen,
  SelectField,
  SwitchRow,
  TextField,
} from '../../components/ui';
import { useAsync, useSubmit } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { money } from '../../lib/format';
import { toast } from '../../lib/toast';
import { useSession } from '../../store/session';

interface CategoryRow {
  id: string;
  name: string;
}

interface UnitRow {
  id: string;
  code: string;
  name: string;
  allowDecimal: boolean;
}

interface TaxRow {
  id: string;
  name: string;
  rate: number;
  isDefault: boolean;
}

interface AttributeDefinition {
  id: string;
  key: string;
  label: string;
  dataType: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'BOOLEAN';
  options: string[];
  isRequired: boolean;
}

interface ProductVariantRow {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  purchasePricePaise: number;
  sellingPricePaise: number;
  mrpPaise: number;
  minStock: number;
  isDefault: boolean;
  inventory: { quantity: number } | null;
}

interface ProductResponse {
  id: string;
  name: string;
  categoryId: string | null;
  brand: { id: string; name: string } | null;
  unit: { code: string };
  taxId: string | null;
  trackBatch: boolean;
  trackExpiry: boolean;
  trackSerial: boolean;
  isComposite: boolean;
  attributes: Record<string, string>;
  variants: ProductVariantRow[];
}

interface VariantDraft {
  key: string;
  name: string;
  sku: string;
  barcode: string;
  sellingPricePaise: number;
  mrpPaise: number;
  openingStock: number;
}

interface Draft {
  name: string;
  categoryId: string;
  categoryName: string;
  brandName: string;
  unitCode: string;
  sellingPricePaise: number;
  purchasePricePaise: number;
  mrpPaise: number;
  taxId: string;
  minStock: number;
  openingStock: number;
  sku: string;
  barcode: string;
  trackBatch: boolean;
  trackExpiry: boolean;
  trackSerial: boolean;
  isComposite: boolean;
  attributes: Record<string, string>;
  variants: VariantDraft[];
}

const EMPTY: Draft = {
  name: '',
  categoryId: '',
  categoryName: '',
  brandName: '',
  unitCode: '',
  sellingPricePaise: 0,
  purchasePricePaise: 0,
  mrpPaise: 0,
  taxId: '',
  minStock: 0,
  openingStock: 0,
  sku: '',
  barcode: '',
  trackBatch: false,
  trackExpiry: false,
  trackSerial: false,
  isComposite: false,
  attributes: {},
  variants: [],
};

/** Chosen in the category list when the shop owner wants to type a new one. */
const NEW_CATEGORY = '__new__';

const newVariantKey = () => `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Add a product, or change one. Same screen, same words, both ways. */
export function ProductForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const can = useSession((state) => state.can);
  const hasFeature = useSession((state) => state.hasFeature);
  const settings = useSession((state) => state.settings);

  const [draft, setDraft] = useState<Draft>({ ...EMPTY, barcode: params.get('barcode') ?? '' });
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanningVariant, setScanningVariant] = useState<string | null>(null);

  const catalogue = useAsync(async () => {
    const [categories, units, taxes, attributes] = await Promise.all([
      api.get<{ categories: CategoryRow[] }>('/business/categories'),
      api.get<{ units: UnitRow[] }>('/business/units'),
      api.get<{ taxes: TaxRow[] }>('/business/taxes'),
      api.get<{ attributes: AttributeDefinition[] }>('/business/attributes'),
    ]);
    return {
      categories: categories.categories,
      units: units.units,
      taxes: taxes.taxes,
      attributes: attributes.attributes,
    };
  }, []);

  const existing = useAsync(() => (id ? api.get<ProductResponse>(`/products/${id}`) : Promise.resolve(null)), [id]);
  const savedVariants = existing.data?.variants ?? [];
  const defaultVariant = savedVariants.find((variant) => variant.isDefault) ?? savedVariants[0];

  useEffect(() => {
    const product = existing.data;
    if (!product) return;
    const variant = product.variants.find((row) => row.isDefault) ?? product.variants[0];
    setDraft({
      ...EMPTY,
      name: product.name,
      categoryId: product.categoryId ?? '',
      brandName: product.brand?.name ?? '',
      unitCode: product.unit.code,
      taxId: product.taxId ?? '',
      sellingPricePaise: variant?.sellingPricePaise ?? 0,
      purchasePricePaise: variant?.purchasePricePaise ?? 0,
      mrpPaise: variant?.mrpPaise ?? 0,
      minStock: variant?.minStock ?? 0,
      sku: variant?.sku ?? '',
      barcode: variant?.barcode ?? '',
      trackBatch: product.trackBatch,
      trackExpiry: product.trackExpiry,
      trackSerial: product.trackSerial,
      isComposite: product.isComposite,
      attributes: { ...product.attributes },
    });
  }, [existing.data]);

  useEffect(() => {
    const lists = catalogue.data;
    if (editing || !lists) return;
    setDraft((current) => ({
      ...current,
      unitCode: current.unitCode || lists.units[0]?.code || '',
      taxId: current.taxId || lists.taxes.find((tax) => tax.isDefault)?.id || '',
    }));
  }, [editing, catalogue.data]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const setAttribute = (key: string, value: string) =>
    setDraft((current) => ({ ...current, attributes: { ...current.attributes, [key]: value } }));

  const setVariant = (key: string, patch: Partial<VariantDraft>) =>
    setDraft((current) => ({
      ...current,
      variants: current.variants.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    }));

  const save = useSubmit(async (options: { ignoreDuplicate?: boolean } = {}) => {
    const body = buildPayload(draft, { editing, ignoreDuplicate: options.ignoreDuplicate });

    if (editing && id) {
      await api.put<ProductResponse>(`/products/${id}`, body);
      // PUT only touches the default variant, so extra rows are added one by one.
      for (const row of draft.variants) {
        await api.post(`/products/${id}/variants`, variantPayload(row, draft, { editing: true }));
      }
      toast.success('Product saved.');
      navigate(`/products/${id}`, { replace: true });
      return;
    }

    const created = await api.post<ProductResponse>('/products', body);
    toast.success('Product added.');
    navigate(`/products/${created.id}`, { replace: true });
  });

  /**
   * The duplicate warning only carries the matching variant, so the product it
   * belongs to is looked up again before opening it.
   */
  const openExisting = async (variantId: string) => {
    try {
      const outcome = await api.post<{
        best: { variantId: string; productId: string } | null;
        candidates: Array<{ variantId: string; productId: string }>;
      }>('/products/match', {
        name: draft.name.trim() || undefined,
        barcode: draft.barcode.trim() || undefined,
        sku: draft.sku.trim() || undefined,
      });
      const match = [outcome.best, ...outcome.candidates].find((row) => row?.variantId === variantId);
      if (match) {
        navigate(`/products/${match.productId}`, { replace: true });
        return;
      }
    } catch {
      // Falling back to the stock card still gets the owner to the product.
    }
    navigate(`/stock/${variantId}`);
  };

  const generateBarcode = useSubmit(async (variantId: string) => {
    const result = await api.post<{ barcode: string; generated: boolean }>(`/products/variants/${variantId}/barcode`);
    set('barcode', result.barcode);
    toast.success(result.generated ? 'Barcode made. Print it and stick it on the pack.' : 'This item already has a barcode.');
  });

  if (!can('product:write')) {
    return (
      <>
        <TopBar title={editing ? 'Edit Product' : 'Add Product'} back />
        <Screen>
          <Empty icon="🔒" title="You cannot change products" hint="Ask the shop owner to do this." />
        </Screen>
      </>
    );
  }

  const lists = catalogue.data;
  const showBatch = hasFeature('BATCH_TRACKING');
  const showExpiry = hasFeature('EXPIRY_TRACKING');
  const showSerial = hasFeature('SERIAL_TRACKING') || hasFeature('IMEI');
  const showRecipe = hasFeature('RECIPES');
  const showTracking = showBatch || showExpiry || showSerial || showRecipe;
  const showVariants = hasFeature('VARIANTS') || savedVariants.length > 1;
  const unitLabel = lists?.units.find((unit) => unit.code === draft.unitCode)?.name.toLowerCase() ?? 'unit';

  return (
    <>
      <TopBar
        title={editing ? 'Edit Product' : 'Add Product'}
        back
        subtitle={editing ? existing.data?.name : 'Name and price are enough to start'}
      />
      <Screen>
        <ErrorNotice error={existing.error} onRetry={existing.reload} />
        <ErrorNotice error={catalogue.error} onRetry={catalogue.reload} />
        {(existing.loading && !existing.data) || (catalogue.loading && !lists) ? <Loading /> : null}

        <Card title="Basic">
          <div className="form-grid">
            <TextField
              label="Product name"
              value={draft.name}
              onChange={(value) => set('name', value)}
              placeholder="Tata Salt 1kg"
              autoFocus={!editing}
            />
            <SelectField
              label="Category"
              value={draft.categoryId}
              onChange={(value) => set('categoryId', value)}
              placeholder="No category"
              options={[
                ...(lists?.categories ?? []).map((category) => ({ value: category.id, label: category.name })),
                { value: NEW_CATEGORY, label: '+ New category' },
              ]}
            />
            {draft.categoryId === NEW_CATEGORY ? (
              <TextField
                label="New category name"
                value={draft.categoryName}
                onChange={(value) => set('categoryName', value)}
                placeholder="Staples"
                hint="It is added to your list when you save."
              />
            ) : null}
            <TextField
              label="Brand (optional)"
              value={draft.brandName}
              onChange={(value) => set('brandName', value)}
              placeholder="Tata"
            />
            <SelectField
              label="Sold by"
              value={draft.unitCode}
              onChange={(value) => set('unitCode', value)}
              options={(lists?.units ?? []).map((unit) => ({ value: unit.code, label: `${unit.name} (${unit.code})` }))}
              hint="Piece, kilogram, litre and so on."
            />
          </div>
        </Card>

        <Card title="Pricing">
          <div className="form-grid">
            <div className="form-row">
              <MoneyField
                label="Selling price"
                valuePaise={draft.sellingPricePaise}
                onChange={(value) => set('sellingPricePaise', value)}
              />
              <MoneyField
                label="Purchase price"
                valuePaise={draft.purchasePricePaise}
                onChange={(value) => set('purchasePricePaise', value)}
              />
            </div>
            <MoneyField
              label="MRP (optional)"
              valuePaise={draft.mrpPaise}
              onChange={(value) => set('mrpPaise', value)}
              hint="Printed on the pack. Left empty, the selling price is used."
            />
            {draft.sellingPricePaise > 0 && draft.purchasePricePaise > 0 ? (
              <p className="muted">
                You earn {money(draft.sellingPricePaise - draft.purchasePricePaise)} on each {unitLabel}.
              </p>
            ) : null}
          </div>
        </Card>

        {settings?.taxEnabled ? (
          <Card title={settings.taxLabel || 'Tax'}>
            <SelectField
              value={draft.taxId}
              onChange={(value) => set('taxId', value)}
              placeholder="No tax"
              options={(lists?.taxes ?? []).map((tax) => ({ value: tax.id, label: `${tax.name} · ${tax.rate}%` }))}
              hint={settings.pricesIncludeTax ? 'Your prices already include tax.' : 'Tax is added on top of your price.'}
            />
          </Card>
        ) : null}

        <Card title="Stock">
          <div className="form-grid">
            <NumberField
              label="Tell me when stock falls below"
              value={draft.minStock}
              onChange={(value) => set('minStock', value)}
              hint={`In ${unitLabel}. Keep 0 for no alert.`}
            />
            {editing ? (
              <p className="muted">Stock is changed from the stock screen, so the count stays honest.</p>
            ) : (
              <NumberField
                label="Stock right now"
                value={draft.openingStock}
                onChange={(value) => set('openingStock', value)}
                hint="How much is on the shelf today."
              />
            )}
          </div>
        </Card>

        <Card title="Barcode">
          <div className="form-grid">
            <TextField
              label="SKU (your own code)"
              value={draft.sku}
              onChange={(value) => set('sku', value)}
              placeholder="Left empty, we make one"
            />
            <TextField
              label="Barcode"
              value={draft.barcode}
              onChange={(value) => set('barcode', value)}
              inputMode="numeric"
              placeholder="8901234567890"
            />
            <div className="row">
              <button
                type="button"
                className="btn btn-secondary grow"
                onClick={() => {
                  setScanningVariant(null);
                  setScannerOpen(true);
                }}
              >
                Scan
              </button>
              {defaultVariant ? (
                <button
                  type="button"
                  className="btn btn-outline grow"
                  disabled={generateBarcode.busy}
                  onClick={() => void generateBarcode.run(defaultVariant.id)}
                >
                  {generateBarcode.busy ? 'Making…' : 'Generate barcode'}
                </button>
              ) : null}
            </div>
            {!defaultVariant ? (
              <p className="muted">Save the product first to make a barcode for it.</p>
            ) : null}
            {!editing && draft.variants.length ? (
              <p className="muted">You added variants, so each variant keeps its own SKU and barcode.</p>
            ) : null}
            <ErrorNotice error={generateBarcode.error} />
          </div>
        </Card>

        {lists?.attributes.length ? (
          <Card title="Custom details">
            <div className="form-grid">
              {lists.attributes.map((definition) => (
                <AttributeInput
                  key={definition.id}
                  definition={definition}
                  value={draft.attributes[definition.key] ?? ''}
                  onChange={(value) => setAttribute(definition.key, value)}
                />
              ))}
            </div>
          </Card>
        ) : null}

        {showTracking ? (
          <Card title="How you track it">
            {showBatch ? (
              <SwitchRow
                title="Track batches"
                description="Keep each lot separate, as printed on the pack."
                checked={draft.trackBatch}
                onChange={(value) => set('trackBatch', value)}
              />
            ) : null}
            {showExpiry ? (
              <SwitchRow
                title="Track expiry"
                description="Warns you before the stock goes bad."
                checked={draft.trackExpiry}
                onChange={(value) => set('trackExpiry', value)}
              />
            ) : null}
            {showSerial ? (
              <SwitchRow
                title="Track serial / IMEI numbers"
                description="Each piece is billed by its own number."
                checked={draft.trackSerial}
                onChange={(value) => set('trackSerial', value)}
              />
            ) : null}
            {showRecipe ? (
              <SwitchRow
                title="Made from a recipe"
                description="Selling this uses up the ingredients."
                checked={draft.isComposite}
                onChange={(value) => set('isComposite', value)}
              />
            ) : null}
          </Card>
        ) : null}

        {showVariants ? (
          <Card
            title="Variants"
            action={
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    variants: [
                      ...current.variants,
                      { key: newVariantKey(), name: '', sku: '', barcode: '', sellingPricePaise: current.sellingPricePaise, mrpPaise: current.mrpPaise, openingStock: 0 },
                    ],
                  }))
                }
              >
                Add variant
              </button>
            }
          >
            <div className="form-grid">
              {savedVariants.length ? (
                <div>
                  <div className="section-heading">Already saved</div>
                  {savedVariants.map((variant) => (
                    <div className="row-between" key={variant.id} style={{ padding: '6px 0' }}>
                      <span>{variant.isDefault ? `${variant.name} · main` : variant.name}</span>
                      <strong>{money(variant.sellingPricePaise)}</strong>
                    </div>
                  ))}
                </div>
              ) : null}

              {draft.variants.map((row) => (
                <div className="card" key={row.key} style={{ boxShadow: 'none', background: 'var(--ink-50)' }}>
                  <div className="form-grid">
                    <TextField
                      label="Variant name"
                      value={row.name}
                      onChange={(value) => setVariant(row.key, { name: value })}
                      placeholder="Red / M"
                    />
                    <div className="form-row">
                      <TextField
                        label="SKU"
                        value={row.sku}
                        onChange={(value) => setVariant(row.key, { sku: value })}
                        placeholder="Optional"
                      />
                      <TextField
                        label="Barcode"
                        value={row.barcode}
                        onChange={(value) => setVariant(row.key, { barcode: value })}
                        inputMode="numeric"
                        placeholder="Optional"
                      />
                    </div>
                    <div className="form-row">
                      <MoneyField
                        label="Selling price"
                        valuePaise={row.sellingPricePaise}
                        onChange={(value) => setVariant(row.key, { sellingPricePaise: value })}
                      />
                      <MoneyField
                        label="MRP"
                        valuePaise={row.mrpPaise}
                        onChange={(value) => setVariant(row.key, { mrpPaise: value })}
                      />
                    </div>
                    {editing ? null : (
                      <NumberField
                        label="Stock right now"
                        value={row.openingStock}
                        onChange={(value) => setVariant(row.key, { openingStock: value })}
                      />
                    )}
                    <div className="row">
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost grow"
                        onClick={() => {
                          setScanningVariant(row.key);
                          setScannerOpen(true);
                        }}
                      >
                        Scan barcode
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            variants: current.variants.filter((entry) => entry.key !== row.key),
                          }))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {!draft.variants.length ? (
                <p className="muted">
                  Add a row for each size, colour or pack. Without rows, the product is sold as one item.
                </p>
              ) : null}
            </div>
          </Card>
        ) : null}

        {draft.sellingPricePaise === 0 ? (
          <Banner tone="warning" icon="₹">
            No selling price yet. Billing will charge ₹0 for this product.
          </Banner>
        ) : null}

        <ErrorNotice
          error={save.error}
          onAction={(action) => {
            if (action.action === 'CREATE_ANYWAY') {
              void save.run({ ignoreDuplicate: true });
              return;
            }
            if (action.action === 'USE_EXISTING') {
              const variantId = action.payload?.variantId;
              if (typeof variantId === 'string') void openExisting(variantId);
            }
          }}
        />

        <button
          type="button"
          className="btn btn-block btn-lg"
          disabled={save.busy || !draft.name.trim() || (draft.categoryId === NEW_CATEGORY && !draft.categoryName.trim())}
          onClick={() => void save.run({})}
        >
          {save.busy ? 'Saving…' : editing ? 'Save Changes' : 'Add Product'}
        </button>
      </Screen>

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(code) => {
          if (scanningVariant) setVariant(scanningVariant, { barcode: code });
          else set('barcode', code);
          setScannerOpen(false);
          setScanningVariant(null);
        }}
      />
    </>
  );
}

function AttributeInput({
  definition,
  value,
  onChange,
}: {
  definition: AttributeDefinition;
  value: string;
  onChange: (value: string) => void;
}) {
  if (definition.dataType === 'BOOLEAN') {
    return (
      <SwitchRow title={definition.label} checked={value === 'true'} onChange={(checked) => onChange(String(checked))} />
    );
  }
  if (definition.dataType === 'SELECT') {
    return (
      <SelectField
        label={definition.label}
        value={value}
        onChange={onChange}
        placeholder="Not set"
        options={definition.options.map((option) => ({ value: option, label: option }))}
      />
    );
  }
  if (definition.dataType === 'NUMBER') {
    return (
      <NumberField
        label={definition.label}
        value={Number(value || 0)}
        onChange={(next) => onChange(next ? String(next) : '')}
      />
    );
  }
  if (definition.dataType === 'DATE') {
    return <TextField label={definition.label} value={value} onChange={onChange} type="date" />;
  }
  return <TextField label={definition.label} value={value} onChange={onChange} />;
}

function variantPayload(row: VariantDraft, draft: Draft, options: { editing: boolean }) {
  return {
    name: row.name.trim() || undefined,
    sku: row.sku.trim() || undefined,
    barcode: row.barcode.trim() || null,
    purchasePricePaise: draft.purchasePricePaise,
    sellingPricePaise: row.sellingPricePaise || draft.sellingPricePaise,
    mrpPaise: row.mrpPaise || row.sellingPricePaise || draft.sellingPricePaise,
    minStock: draft.minStock,
    openingStock: options.editing ? undefined : row.openingStock || undefined,
  };
}

function buildPayload(draft: Draft, options: { editing: boolean; ignoreDuplicate?: boolean }) {
  const attributes = Object.fromEntries(
    Object.entries(draft.attributes).filter(([, value]) => value !== ''),
  );

  const body: Record<string, unknown> = {
    name: draft.name.trim(),
    brandName: draft.brandName.trim() || null,
    unitCode: draft.unitCode || null,
    taxId: draft.taxId || null,
    trackBatch: draft.trackBatch,
    trackExpiry: draft.trackExpiry,
    trackSerial: draft.trackSerial,
    isComposite: draft.isComposite,
    attributes,
    ...(draft.categoryId === NEW_CATEGORY
      ? { categoryName: draft.categoryName.trim() }
      : { categoryId: draft.categoryId || null }),
  };

  if (!options.editing && draft.variants.length) {
    body.variants = draft.variants.map((row) => variantPayload(row, draft, { editing: false }));
  } else {
    body.sku = draft.sku.trim() || undefined;
    body.barcode = draft.barcode.trim() || null;
    body.sellingPricePaise = draft.sellingPricePaise;
    body.purchasePricePaise = draft.purchasePricePaise;
    body.mrpPaise = draft.mrpPaise || draft.sellingPricePaise;
    body.minStock = draft.minStock;
    if (!options.editing) body.openingStock = draft.openingStock || undefined;
  }

  if (options.ignoreDuplicate) body.ignoreDuplicateWarning = true;
  return body;
}
