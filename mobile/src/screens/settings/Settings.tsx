import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../../components/AppShell';
import { Card, ErrorNotice, Screen, Sheet, TextField } from '../../components/ui';
import { useSubmit } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';
import { useSession } from '../../store/session';

const FEATURE_LABELS: Record<string, string> = {
  BARCODE: 'Barcode scanning',
  LOOSE_QUANTITY: 'Loose quantities (kg, litre)',
  UNIT_CONVERSION: 'Unit conversion (box to pieces)',
  MRP: 'MRP on products',
  BATCH_TRACKING: 'Batch numbers',
  EXPIRY_TRACKING: 'Expiry dates',
  FEFO: 'Sell the earliest expiry first',
  SERIAL_TRACKING: 'Serial numbers',
  IMEI: 'IMEI',
  WARRANTY: 'Warranty',
  VARIANTS: 'Size and colour variants',
  RECIPES: 'Recipes',
  PRODUCTION: 'Production',
  WASTAGE: 'Wastage',
  TABLE_MANAGEMENT: 'Tables',
  TAKEAWAY_DELIVERY: 'Takeaway and delivery',
  PRESCRIPTION: 'Prescription notes',
  BULK_PRICING: 'Bulk pricing',
  EXCHANGES: 'Exchanges',
  COMPATIBILITY: 'Phone compatibility',
  OFFERS: 'Offers',
};

/** The quiet corner of the app: shop details, tax, staff, and the PIN. */
export function Settings() {
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const user = useSession((state) => state.user);
  const business = useSession((state) => state.business);
  const features = useSession((state) => state.features);
  const signOut = useSession((state) => state.signOut);
  const refreshMe = useSession((state) => state.refreshMe);
  const [pinOpen, setPinOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);

  return (
    <>
      <TopBar title="Settings" back subtitle={business?.name} />
      <Screen>
        <Card flush>
          <div className="list-item">
            <div className="avatar">{user?.name.slice(0, 2).toUpperCase()}</div>
            <div className="li-main">
              <div className="li-title">{user?.name}</div>
              <div className="li-sub">
                {user?.role === 'OWNER' ? 'Owner' : user?.role === 'MANAGER' ? 'Manager' : 'Cashier'} · {user?.phone}
              </div>
            </div>
          </div>
        </Card>

        <Card title="Shop" flush>
          <div className="list">
            <Row icon="🏪" title="Business" hint="Name, address, GSTIN" onClick={() => navigate('/settings/business')} />
            <Row icon="🧾" title="Tax" hint="GST on or off, rates" onClick={() => navigate('/settings/tax')} />
            {can('user:manage') ? (
              <Row icon="👤" title="Staff" hint="Who can use the app" onClick={() => navigate('/settings/staff')} />
            ) : null}
            {can('settings:write') ? (
              <Row
                icon="🧩"
                title="Shop features"
                hint="What this kind of shop tracks"
                onClick={() => setFeaturesOpen(true)}
              />
            ) : null}
          </div>
        </Card>

        <Card title="You" flush>
          <div className="list">
            <Row icon="🔢" title="Change PIN" hint="4 to 6 digits" onClick={() => setPinOpen(true)} />
            <Row icon="🚪" title="Sign out" hint="This phone forgets the shop" onClick={() => void signOut()} />
          </div>
        </Card>
      </Screen>

      <PinSheet open={pinOpen} onClose={() => setPinOpen(false)} />
      <FeatureSheet
        open={featuresOpen}
        features={features}
        onClose={() => setFeaturesOpen(false)}
        onSaved={() => void refreshMe()}
      />
    </>
  );
}

function Row({ icon, title, hint, onClick }: { icon: string; title: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" className="list-item" onClick={onClick}>
      <div className="avatar">{icon}</div>
      <div className="li-main">
        <div className="li-title">{title}</div>
        <div className="li-sub">{hint}</div>
      </div>
      <span className="chev">›</span>
    </button>
  );
}

function PinSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [again, setAgain] = useState('');

  const save = useSubmit(async () => {
    if (newPin !== again) {
      toast.info('The two new PINs do not match.');
      return;
    }
    await api.post('/auth/change-pin', { currentPin, newPin });
    toast.success('PIN changed.');
    setCurrentPin('');
    setNewPin('');
    setAgain('');
    onClose();
  });

  return (
    <Sheet open={open} title="Change PIN" onClose={onClose}>
      <div className="stack">
        <TextField label="Current PIN" type="password" inputMode="numeric" value={currentPin} onChange={setCurrentPin} maxLength={6} />
        <TextField label="New PIN" type="password" inputMode="numeric" value={newPin} onChange={setNewPin} maxLength={6} />
        <TextField label="New PIN again" type="password" inputMode="numeric" value={again} onChange={setAgain} maxLength={6} />
        <ErrorNotice error={save.error} />
        <button
          type="button"
          className="btn btn-block btn-lg"
          disabled={save.busy || currentPin.length < 4 || !/^\d{4,6}$/.test(newPin)}
          onClick={() => void save.run()}
        >
          {save.busy ? 'Saving…' : 'Save PIN'}
        </button>
      </div>
    </Sheet>
  );
}

function FeatureSheet({
  open,
  features,
  onClose,
  onSaved,
}: {
  open: boolean;
  features: Record<string, boolean>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(features);

  useEffect(() => {
    if (open) setDraft(features);
  }, [open, features]);

  const save = useSubmit(async () => {
    await api.patch('/business/settings', { featureOverrides: draft });
    toast.success('Shop features updated.');
    onSaved();
    onClose();
  });

  return (
    <Sheet
      open={open}
      title="Shop features"
      onClose={() => {
        setDraft(features);
        onClose();
      }}
    >
      <div className="stack">
        <p className="muted">Turn on only what this shop actually uses. Extra fields stay hidden.</p>
        {Object.entries(FEATURE_LABELS).map(([key, label]) => (
          <div className="switch-row" key={key}>
            <div className="switch-label">
              <strong>{label}</strong>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(draft[key])}
              className={draft[key] ? 'switch on' : 'switch'}
              onClick={() => setDraft((current) => ({ ...current, [key]: !current[key] }))}
            />
          </div>
        ))}
        <ErrorNotice error={save.error} />
        <button type="button" className="btn btn-block" disabled={save.busy} onClick={() => void save.run()}>
          {save.busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Sheet>
  );
}
