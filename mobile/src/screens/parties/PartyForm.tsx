import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../../components/AppShell';
import { Banner, Card, ErrorNotice, MoneyField, Screen, TextAreaField, TextField } from '../../components/ui';
import { useSubmit } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';
import { useSession } from '../../store/session';

export type PartyKind = 'CUSTOMER' | 'SUPPLIER';

export interface PartyValues {
  name: string;
  phone: string;
  email: string;
  address: string;
  gstin: string;
  creditLimitPaise: number;
  openingBalancePaise: number;
}

const COPY = {
  CUSTOMER: {
    title: 'New Customer',
    save: 'Save Customer',
    namePlaceholder: 'Ramesh Kumar',
    openingLabel: 'Money they already owe',
    openingHint: 'What this customer owes you from before today. Leave it at 0 if they owe nothing.',
    path: '/customers',
    permission: 'customer:write',
  },
  SUPPLIER: {
    title: 'New Supplier',
    save: 'Save Supplier',
    namePlaceholder: 'Sharma Distributors',
    openingLabel: 'Money you already owe them',
    openingHint: 'What you owe this supplier from before today. Leave it at 0 if you owe nothing.',
    path: '/suppliers',
    permission: 'supplier:write',
  },
} as const;

export const emptyPartyValues = (): PartyValues => ({
  name: '',
  phone: '',
  email: '',
  address: '',
  gstin: '',
  creditLimitPaise: 0,
  openingBalancePaise: 0,
});

export const partyValuesOf = (party: {
  name: string;
  phone: string | null;
  email?: string | null;
  address?: string | null;
  gstin?: string | null;
  creditLimitPaise?: number;
}): PartyValues => ({
  name: party.name,
  phone: party.phone ?? '',
  email: party.email ?? '',
  address: party.address ?? '',
  gstin: party.gstin ?? '',
  creditLimitPaise: party.creditLimitPaise ?? 0,
  openingBalancePaise: 0,
});

/** The body both `POST /customers|/suppliers` and their `PUT` counterparts take. */
export function partyBody(
  kind: PartyKind,
  values: PartyValues,
  options: { withOpeningBalance?: boolean } = {},
): Record<string, unknown> {
  return {
    name: values.name.trim(),
    phone: values.phone.trim() || null,
    email: values.email.trim() || null,
    address: values.address.trim() || null,
    gstin: values.gstin.trim() || null,
    ...(kind === 'CUSTOMER' ? { creditLimitPaise: values.creditLimitPaise } : {}),
    ...(options.withOpeningBalance ? { openingBalancePaise: values.openingBalancePaise } : {}),
  };
}

/**
 * The same short form wherever a person is added or corrected: the new-party
 * screen and the edit sheets on the two detail screens.
 */
export function PartyFields({
  kind,
  values,
  onChange,
  withOpeningBalance,
}: {
  kind: PartyKind;
  values: PartyValues;
  onChange: (values: PartyValues) => void;
  withOpeningBalance?: boolean;
}) {
  const set = <K extends keyof PartyValues>(key: K, value: PartyValues[K]) => onChange({ ...values, [key]: value });

  return (
    <div className="form-grid">
      <TextField
        label="Name"
        value={values.name}
        onChange={(value) => set('name', value)}
        placeholder={COPY[kind].namePlaceholder}
        autoFocus
      />
      <TextField
        label="Phone number"
        value={values.phone}
        onChange={(value) => set('phone', value)}
        type="tel"
        inputMode="tel"
        maxLength={15}
        placeholder="98765 43210"
        hint="Used to find them at the counter."
      />
      <TextField label="Email (optional)" value={values.email} onChange={(value) => set('email', value)} type="email" />
      <TextAreaField label="Address (optional)" value={values.address} onChange={(value) => set('address', value)} />
      <TextField
        label="GSTIN (optional)"
        value={values.gstin}
        onChange={(value) => set('gstin', value)}
        maxLength={20}
        placeholder="27ABCDE1234F1Z5"
      />
      {kind === 'CUSTOMER' ? (
        <MoneyField
          label="Credit limit"
          valuePaise={values.creditLimitPaise}
          onChange={(value) => set('creditLimitPaise', value)}
          hint="How much credit you will give at most. 0 means no limit."
        />
      ) : null}
      {withOpeningBalance ? (
        <MoneyField
          label={COPY[kind].openingLabel}
          valuePaise={values.openingBalancePaise}
          onChange={(value) => set('openingBalancePaise', value)}
          hint={COPY[kind].openingHint}
        />
      ) : null}
    </div>
  );
}

export function PartyForm({ kind }: { kind: 'CUSTOMER' | 'SUPPLIER' }) {
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const sync = useSession((state) => state.sync);
  const copy = COPY[kind];
  const [values, setValues] = useState<PartyValues>(emptyPartyValues());
  const allowed = can(copy.permission);

  const save = useSubmit(async () => {
    const party = await api.post<{ id: string; name: string }>(
      copy.path,
      partyBody(kind, values, { withOpeningBalance: true }),
    );
    toast.success(`${party.name} saved.`);
    // The counter picks people from the phone's own copy, so pull it forward.
    void sync();
    navigate(`${copy.path}/${party.id}`, { replace: true });
  });

  return (
    <>
      <TopBar title={copy.title} back />
      <Screen>
        {!allowed ? (
          <Banner tone="warning" icon="🔒">
            Your role cannot add {kind === 'CUSTOMER' ? 'customers' : 'suppliers'}. Ask the owner or manager.
          </Banner>
        ) : null}

        <Card>
          <PartyFields kind={kind} values={values} onChange={setValues} withOpeningBalance />
        </Card>

        <ErrorNotice error={save.error} />

        <button
          type="button"
          className="btn btn-block btn-lg"
          disabled={!allowed || save.busy || values.name.trim().length < 2}
          onClick={() => void save.run()}
        >
          {save.busy ? 'Saving…' : copy.save}
        </button>
      </Screen>
    </>
  );
}
