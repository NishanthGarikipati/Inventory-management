import { useEffect, useState } from 'react';
import { TopBar } from '../../components/AppShell';
import { ErrorNotice, Loading, Screen, TextAreaField, TextField } from '../../components/ui';
import { useAsync, useSubmit } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';
import { useSession } from '../../store/session';
import type { Business } from '../../lib/types';

interface BusinessResponse {
  business: Business & { email: string | null };
}

/** The shop's own card: name, owner, address, GSTIN. */
export function BusinessProfile() {
  const can = useSession((state) => state.can);
  const refreshMe = useSession((state) => state.refreshMe);
  const loaded = useAsync(() => api.get<BusinessResponse>('/business'), []);
  const business = loaded.data?.business;

  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [gstin, setGstin] = useState('');

  useEffect(() => {
    if (!business) return;
    setName(business.name);
    setOwnerName(business.ownerName);
    setPhone(business.phone);
    setEmail(business.email ?? '');
    setAddress(business.address ?? '');
    setGstin(business.gstin ?? '');
  }, [business]);

  const save = useSubmit(async () => {
    await api.patch('/business', {
      name: name.trim(),
      ownerName: ownerName.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
      address: address.trim() || null,
      gstin: gstin.trim() || null,
    });
    await refreshMe();
    toast.success('Shop details saved.');
  });

  const locked = !can('settings:write');

  return (
    <>
      <TopBar title="Business" back />
      <Screen narrow>
        <ErrorNotice error={loaded.error} onRetry={loaded.reload} />
        {loaded.loading && !business ? <Loading /> : null}
        {business ? (
          <div className="stack">
            <TextField label="Shop name" value={name} onChange={setName} disabled={locked} />
            <TextField label="Owner name" value={ownerName} onChange={setOwnerName} disabled={locked} />
            <TextField label="Mobile number" value={phone} onChange={setPhone} type="tel" inputMode="tel" disabled={locked} />
            <TextField label="Email" value={email} onChange={setEmail} type="email" inputMode="email" disabled={locked} />
            <TextAreaField label="Address" value={address} onChange={locked ? () => undefined : setAddress} />
            <TextField label="GSTIN (optional)" value={gstin} onChange={setGstin} disabled={locked} />
            <p className="muted">
              Currency {business.currency} · {business.country === 'IN' ? 'India' : business.country}
            </p>
            <ErrorNotice error={save.error} />
            {locked ? (
              <p className="muted">Only the owner can change these details.</p>
            ) : (
              <button
                type="button"
                className="btn btn-block btn-lg"
                disabled={save.busy || name.trim().length < 2 || ownerName.trim().length < 2 || phone.trim().length < 10}
                onClick={() => void save.run()}
              >
                {save.busy ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        ) : null}
      </Screen>
    </>
  );
}
