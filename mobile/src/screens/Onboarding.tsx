import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { useSession } from '../store/session';
import {
  ErrorNotice,
  Loading,
  NumberPad,
  SwitchRow,
  TextAreaField,
  TextField,
} from '../components/ui';

interface BusinessTypeCard {
  code: string;
  name: string;
  description: string;
  icon: string;
}

interface Draft {
  businessType: string;
  businessName: string;
  ownerName: string;
  phone: string;
  address: string;
  gstin: string;
  currency: string;
  country: string;
  taxEnabled: boolean;
  pricesIncludeTax: boolean;
  defaultTaxRate: number;
  pin: string;
  confirmPin: string;
}

const EMPTY: Draft = {
  businessType: '',
  businessName: '',
  ownerName: '',
  phone: '',
  address: '',
  gstin: '',
  currency: 'INR',
  country: 'IN',
  taxEnabled: true,
  pricesIncludeTax: true,
  defaultTaxRate: 5,
  pin: '',
  confirmPin: '',
};

const STEPS = 5;

/** Five short screens. Nothing is asked twice and only the name is mandatory. */
export function Onboarding() {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const signIn = useSession((state) => state.signIn);

  const types = useAsync(() => api.get<{ businessTypes: BusinessTypeCard[] }>('/auth/business-types'), []);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const { run, busy, error } = useSubmit(async () => {
    const result = await api.post<{ accessToken: string; refreshToken: string }>('/auth/register', {
      businessName: draft.businessName.trim(),
      ownerName: draft.ownerName.trim(),
      phone: draft.phone.trim(),
      address: draft.address.trim() || undefined,
      gstin: draft.gstin.trim() || undefined,
      businessType: draft.businessType,
      pin: draft.pin,
      currency: draft.currency,
      country: draft.country,
      taxEnabled: draft.taxEnabled,
      pricesIncludeTax: draft.pricesIncludeTax,
      defaultTaxRate: draft.taxEnabled ? draft.defaultTaxRate : 0,
    });
    await signIn(result.accessToken, result.refreshToken);
  });

  const canContinue = (): boolean => {
    if (step === 1) return Boolean(draft.businessType);
    if (step === 2) return draft.businessName.trim().length >= 2 && draft.ownerName.trim().length >= 2 && draft.phone.length >= 10;
    if (step === 4) return /^\d{4,6}$/.test(draft.pin) && draft.pin === draft.confirmPin;
    return true;
  };

  return (
    <div className="onboarding">
      {step > 0 ? (
        <div className="progress-dots">
          {Array.from({ length: STEPS - 1 }, (_, index) => (
            <span key={index} className={index === step - 1 ? 'active' : ''} />
          ))}
        </div>
      ) : null}

      {step === 0 ? (
        <>
          <div className="onboarding-hero">
            <div className="hero-mark">🏪</div>
            <h1>Dukaan</h1>
            <h2 style={{ fontWeight: 500 }}>Manage your shop simply.</h2>
            <p className="muted">
              Stock, billing, customers and accounts in one place. Works even when the internet does not.
            </p>
          </div>
          <button type="button" className="btn btn-block btn-lg" onClick={() => setStep(1)}>
            Get Started
          </button>
          <p className="muted" style={{ textAlign: 'center' }}>
            Already have a shop? <Link to="/login">Open it</Link>
          </p>
        </>
      ) : null}

      {step === 1 ? (
        <>
          <div>
            <h1>What kind of shop?</h1>
            <p className="muted">This decides what the app asks you for later.</p>
          </div>
          {types.loading ? <Loading /> : null}
          <ErrorNotice error={types.error} onRetry={types.reload} />
          <div className="type-grid">
            {(types.data?.businessTypes ?? []).map((type) => (
              <button
                key={type.code}
                type="button"
                className={draft.businessType === type.code ? 'type-card selected' : 'type-card'}
                onClick={() => set('businessType', type.code)}
              >
                <span className="type-icon">{type.icon}</span>
                <span className="type-name">{type.name}</span>
                <span className="type-desc">{type.description}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <div>
            <h1>Your shop details</h1>
            <p className="muted">This appears on your bills.</p>
          </div>
          <TextField label="Shop Name" value={draft.businessName} onChange={(v) => set('businessName', v)} autoFocus />
          <TextField label="Your Name" value={draft.ownerName} onChange={(v) => set('ownerName', v)} />
          <TextField
            label="Mobile Number"
            value={draft.phone}
            onChange={(v) => set('phone', v.replace(/[^\d]/g, '').slice(0, 10))}
            inputMode="tel"
            hint="You will use this number to open the app."
          />
          <TextAreaField label="Address (optional)" value={draft.address} onChange={(v) => set('address', v)} />
          <TextField label="GSTIN (optional)" value={draft.gstin} onChange={(v) => set('gstin', v.toUpperCase())} />
        </>
      ) : null}

      {step === 3 ? (
        <>
          <div>
            <h1>Tax and money</h1>
            <p className="muted">You can change all of this later in Settings.</p>
          </div>
          <div className="card">
            <SwitchRow
              title="Charge tax on bills"
              description="Turn off if you bill without GST."
              checked={draft.taxEnabled}
              onChange={(v) => set('taxEnabled', v)}
            />
            <SwitchRow
              title="Prices already include tax"
              description="Most shops in India print MRP with tax inside."
              checked={draft.pricesIncludeTax}
              onChange={(v) => set('pricesIncludeTax', v)}
              disabled={!draft.taxEnabled}
            />
          </div>
          {draft.taxEnabled ? (
            <div>
              <label className="section-heading">Usual tax rate</label>
              <div className="chip-row" style={{ marginTop: 8 }}>
                {[0, 5, 12, 18, 28].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    className={draft.defaultTaxRate === rate ? 'chip active' : 'chip'}
                    onClick={() => set('defaultTaxRate', rate)}
                  >
                    {rate}%
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="card">
            <div className="row-between">
              <span>Currency</span>
              <strong>₹ Indian Rupee</strong>
            </div>
            <div className="row-between" style={{ marginTop: 10 }}>
              <span>Country</span>
              <strong>India</strong>
            </div>
          </div>
        </>
      ) : null}

      {step === 4 ? (
        <>
          <div>
            <h1>{draft.pin.length >= 4 && draft.confirmPin.length > 0 ? 'Type the PIN again' : 'Create a PIN'}</h1>
            <p className="muted">4 to 6 digits. You will type this to open the app.</p>
          </div>
          <ErrorNotice error={error} />
          <div className="pin-display">
            {[0, 1, 2, 3, 4, 5].map((index) => {
              const active = draft.pin.length >= 4 && draft.confirmPin.length > 0 ? draft.confirmPin : draft.pin;
              return <span key={index} className={active.length > index ? 'pin-dot filled' : 'pin-dot'} />;
            })}
          </div>
          {draft.pin.length >= 4 ? (
            <NumberPad value={draft.confirmPin} onChange={(v) => set('confirmPin', v.slice(0, 6))} allowDecimal={false} />
          ) : (
            <NumberPad value={draft.pin} onChange={(v) => set('pin', v.slice(0, 6))} allowDecimal={false} />
          )}
          {draft.pin.length >= 4 && draft.confirmPin.length >= 4 && draft.pin !== draft.confirmPin ? (
            <p className="error-text">The two PINs are different. Please type again.</p>
          ) : null}
          {draft.pin.length >= 4 ? (
            <button
              type="button"
              className="btn btn-ghost btn-block"
              onClick={() => setDraft((current) => ({ ...current, pin: '', confirmPin: '' }))}
            >
              Start PIN again
            </button>
          ) : null}
        </>
      ) : null}

      {step > 0 ? (
        <div className="row" style={{ marginTop: 'auto' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setStep((s) => s - 1)}>
            Back
          </button>
          {step < STEPS - 1 ? (
            <button type="button" className="btn grow" disabled={!canContinue()} onClick={() => setStep((s) => s + 1)}>
              Continue
            </button>
          ) : (
            <button type="button" className="btn grow btn-lg" disabled={!canContinue() || busy} onClick={() => void run()}>
              {busy ? 'Creating…' : 'Open My Shop'}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
