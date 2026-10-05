import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { useSession } from '../store/session';
import { useSubmit } from '../hooks/useAsync';
import { ErrorNotice, NumberPad, TextField } from '../components/ui';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
}

interface ShopChoice {
  businessId: string;
  businessName: string;
}

export function Login() {
  const signIn = useSession((state) => state.signIn);
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [choices, setChoices] = useState<ShopChoice[]>([]);

  const { run, busy, error } = useSubmit(async (businessId?: string) => {
    try {
      const result = await api.post<LoginResponse>('/auth/login', {
        phone: phone.trim(),
        pin,
        ...(businessId ? { businessId } : {}),
      });
      await signIn(result.accessToken, result.refreshToken);
    } catch (cause) {
      // One number can own more than one shop. Ask instead of guessing.
      if (cause instanceof ApiError && cause.code === 'CHOOSE_BUSINESS') {
        setChoices((cause.details as ShopChoice[]) ?? []);
        return;
      }
      setPin('');
      throw cause;
    }
  });

  if (choices.length) {
    return (
      <div className="onboarding">
        <div>
          <h1>Which shop?</h1>
          <p className="muted">This number is used by more than one shop.</p>
        </div>
        <div className="list">
          {choices.map((choice) => (
            <button key={choice.businessId} type="button" className="list-item" onClick={() => void run(choice.businessId)}>
              <div className="avatar">🏪</div>
              <div className="li-main">
                <div className="li-title">{choice.businessName}</div>
              </div>
              <span className="chev">›</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-secondary btn-block" onClick={() => setChoices([])}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="onboarding">
      <div className="onboarding-hero" style={{ flex: '0 0 auto', paddingTop: 12 }}>
        <div className="hero-mark">🏪</div>
        <h1>Welcome back</h1>
        <p className="muted">Open your shop with your mobile number and PIN.</p>
      </div>

      <ErrorNotice error={error} />

      <TextField
        label="Mobile Number"
        value={phone}
        onChange={(value) => setPhone(value.replace(/[^\d]/g, '').slice(0, 10))}
        inputMode="tel"
        placeholder="10 digit number"
      />

      <div>
        <label className="section-heading">PIN</label>
        <div className="pin-display">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <span key={index} className={pin.length > index ? 'pin-dot filled' : 'pin-dot'} />
          ))}
        </div>
        <NumberPad value={pin} onChange={(value) => setPin(value.slice(0, 6))} allowDecimal={false} />
      </div>

      <button
        type="button"
        className="btn btn-block btn-lg"
        disabled={busy || phone.length < 10 || pin.length < 4}
        onClick={() => void run(undefined)}
      >
        {busy ? 'Opening…' : 'Open Shop'}
      </button>

      <p className="muted" style={{ textAlign: 'center' }}>
        New here? <Link to="/welcome">Create your shop</Link>
      </p>
    </div>
  );
}
