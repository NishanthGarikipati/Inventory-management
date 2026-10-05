import { useEffect, useState } from 'react';
import { TopBar } from '../../components/AppShell';
import {
  Badge,
  Card,
  ErrorNotice,
  Loading,
  NumberField,
  Screen,
  Sheet,
  SwitchRow,
  TextField,
} from '../../components/ui';
import { useAsync, useSubmit } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';
import { useSession } from '../../store/session';
import type { BusinessSettings } from '../../lib/types';

interface SettingsResponse {
  settings: BusinessSettings;
}

interface TaxRow {
  id: string;
  name: string;
  rate: number;
  isDefault: boolean;
}

/** GST is a switch, not an assumption. Prices can include tax or sit on top of it. */
export function TaxSettings() {
  const can = useSession((state) => state.can);
  const refreshMe = useSession((state) => state.refreshMe);
  const locked = !can('settings:write');

  const loaded = useAsync(() => api.get<SettingsResponse>('/business/settings'), []);
  const taxes = useAsync(() => api.get<{ taxes: TaxRow[] }>('/business/taxes'), []);
  const settings = loaded.data?.settings;

  const [taxEnabled, setTaxEnabled] = useState(true);
  const [pricesIncludeTax, setPricesIncludeTax] = useState(true);
  const [defaultTaxRate, setDefaultTaxRate] = useState(0);
  const [taxLabel, setTaxLabel] = useState('GST');
  const [expiryAlertDays, setExpiryAlertDays] = useState(30);
  const [lowStockAlerts, setLowStockAlerts] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setTaxEnabled(settings.taxEnabled);
    setPricesIncludeTax(settings.pricesIncludeTax);
    setDefaultTaxRate(settings.defaultTaxRate);
    setTaxLabel(settings.taxLabel);
    setExpiryAlertDays(settings.expiryAlertDays);
    setLowStockAlerts(settings.lowStockAlerts);
  }, [settings]);

  const save = useSubmit(async () => {
    await api.patch('/business/settings', {
      taxEnabled,
      pricesIncludeTax,
      defaultTaxRate,
      taxLabel: taxLabel.trim() || 'GST',
      expiryAlertDays,
      lowStockAlerts,
    });
    await refreshMe();
    toast.success('Tax settings saved.');
  });

  return (
    <>
      <TopBar title="Tax" back />
      <Screen>
        <ErrorNotice error={loaded.error ?? taxes.error} onRetry={loaded.reload} />
        {loaded.loading && !settings ? <Loading /> : null}
        {settings ? (
          <div className="stack">
            <Card>
              <SwitchRow
                title="Charge tax"
                description="Turn off for a shop that does not collect GST."
                checked={taxEnabled}
                disabled={locked}
                onChange={setTaxEnabled}
              />
              <SwitchRow
                title="Prices already include tax"
                description="On for MRP shops. Off when tax is added on top of the price."
                checked={pricesIncludeTax}
                disabled={locked || !taxEnabled}
                onChange={setPricesIncludeTax}
              />
              <TextField label="Tax name" value={taxLabel} onChange={setTaxLabel} disabled={locked} />
              <NumberField
                label="Default tax %"
                value={defaultTaxRate}
                allowDecimal
                onChange={(value) => setDefaultTaxRate(Math.min(100, Math.max(0, value)))}
              />
            </Card>

            <Card
              title="Tax rates"
              action={
                can('settings:write') ? (
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAddOpen(true)}>
                    Add
                  </button>
                ) : null
              }
              flush
            >
              <div className="list">
                {(taxes.data?.taxes ?? []).map((tax) => (
                  <div className="list-item" key={tax.id}>
                    <div className="li-main">
                      <div className="li-title">
                        {tax.name} {tax.isDefault ? <Badge tone="teal">Default</Badge> : null}
                      </div>
                    </div>
                    <div className="li-amount">{tax.rate}%</div>
                  </div>
                ))}
                {!taxes.data?.taxes.length ? <p className="muted" style={{ padding: 16 }}>No tax rates yet.</p> : null}
              </div>
            </Card>

            <Card title="Reminders">
              <SwitchRow
                title="Low stock alerts"
                description="Tell me when a product drops to its minimum."
                checked={lowStockAlerts}
                disabled={locked}
                onChange={setLowStockAlerts}
              />
              <NumberField
                label="Warn before expiry (days)"
                value={expiryAlertDays}
                allowDecimal={false}
                onChange={(value) => setExpiryAlertDays(Math.min(365, Math.max(1, Math.round(value))))}
              />
            </Card>

            <ErrorNotice error={save.error} />
            {locked ? (
              <p className="muted">Only the owner can change tax settings.</p>
            ) : (
              <button type="button" className="btn btn-block btn-lg" disabled={save.busy} onClick={() => void save.run()}>
                {save.busy ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        ) : null}
      </Screen>
      <AddTaxSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          setAddOpen(false);
          taxes.reload();
        }}
      />
    </>
  );
}

function AddTaxSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [rate, setRate] = useState(0);
  const [isDefault, setIsDefault] = useState(false);

  const save = useSubmit(async () => {
    await api.post('/business/taxes', { name: name.trim(), rate, isDefault });
    toast.success('Tax rate added.');
    setName('');
    setRate(0);
    setIsDefault(false);
    onSaved();
  });

  return (
    <Sheet open={open} title="Add tax rate" onClose={onClose}>
      <div className="stack">
        <TextField label="Name" value={name} onChange={setName} placeholder="GST 5%" />
        <NumberField label="Rate %" value={rate} onChange={(value) => setRate(Math.min(100, Math.max(0, value)))} />
        <SwitchRow title="Use as the default" checked={isDefault} onChange={setIsDefault} />
        <ErrorNotice error={save.error} />
        <button
          type="button"
          className="btn btn-block btn-lg"
          disabled={save.busy || name.trim().length < 1}
          onClick={() => void save.run()}
        >
          {save.busy ? 'Saving…' : 'Add Rate'}
        </button>
      </div>
    </Sheet>
  );
}
