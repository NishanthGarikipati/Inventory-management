import { useState } from 'react';
import { TopBar } from '../../components/AppShell';
import {
  Badge,
  Card,
  ChipRow,
  Empty,
  ErrorNotice,
  Loading,
  Screen,
  Sheet,
  TextField,
} from '../../components/ui';
import { useAsync, useSubmit } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';
import { useSession } from '../../store/session';
import type { UserRole } from '../../lib/types';

interface StaffUser {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  isActive: boolean;
}

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'MANAGER', label: 'Manager' },
  { value: 'CASHIER', label: 'Cashier' },
  { value: 'OWNER', label: 'Owner' },
];

const ROLE_HINT: Record<UserRole, string> = {
  OWNER: 'Can change everything, including staff and settings.',
  MANAGER: 'Sells, buys, adjusts stock and sees reports.',
  CASHIER: 'Bills customers and looks up products.',
};

/** People who can open the shop on this app, and what each of them may do. */
export function StaffSettings() {
  const me = useSession((state) => state.user);
  const can = useSession((state) => state.can);
  const [addOpen, setAddOpen] = useState(false);

  const staff = useAsync(() => api.get<{ users: StaffUser[] }>('/auth/users'), []);

  const toggle = useSubmit(async (person: StaffUser) => {
    await api.patch(`/auth/users/${person.id}`, { isActive: !person.isActive });
    toast.success(person.isActive ? `${person.name} can no longer sign in.` : `${person.name} can sign in again.`);
    staff.reload();
  });

  if (!can('user:manage')) {
    return (
      <>
        <TopBar title="Staff" back />
        <Screen>
          <Empty icon="🔒" title="Only the owner manages staff" />
        </Screen>
      </>
    );
  }

  return (
    <>
      <TopBar
        title="Staff"
        back
        actions={
          <button type="button" className="icon-button" aria-label="Add staff" onClick={() => setAddOpen(true)}>
            ➕
          </button>
        }
      />
      <Screen>
        <ErrorNotice error={staff.error} onRetry={staff.reload} />
        {staff.loading && !staff.data ? <Loading /> : null}

        <Card flush>
          <div className="list">
            {(staff.data?.users ?? []).map((person) => (
              <div className="list-item" key={person.id}>
                <div className="avatar">{person.name.slice(0, 2).toUpperCase()}</div>
                <div className="li-main">
                  <div className="li-title">
                    {person.name} {person.id === me?.id ? <Badge tone="teal">You</Badge> : null}{' '}
                    {!person.isActive ? <Badge tone="grey">Off</Badge> : null}
                  </div>
                  <div className="li-sub">
                    {person.role === 'OWNER' ? 'Owner' : person.role === 'MANAGER' ? 'Manager' : 'Cashier'} · {person.phone}
                  </div>
                  <div className="li-sub">{ROLE_HINT[person.role]}</div>
                </div>
                {person.id !== me?.id && person.role !== 'OWNER' ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    disabled={toggle.busy}
                    onClick={() => void toggle.run(person)}
                  >
                    {person.isActive ? 'Disable' : 'Enable'}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
        <ErrorNotice error={toggle.error} />
      </Screen>

      <AddStaffSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          setAddOpen(false);
          staff.reload();
        }}
      />
    </>
  );
}

function AddStaffSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<UserRole>('CASHIER');

  const save = useSubmit(async () => {
    await api.post('/auth/users', { name: name.trim(), phone: phone.trim(), pin, role });
    toast.success(`${name.trim()} can sign in with this phone and PIN.`);
    setName('');
    setPhone('');
    setPin('');
    setRole('CASHIER');
    onSaved();
  });

  return (
    <Sheet open={open} title="Add staff" onClose={onClose}>
      <div className="stack">
        <TextField label="Name" value={name} onChange={setName} />
        <TextField label="Mobile number" value={phone} onChange={setPhone} type="tel" inputMode="tel" />
        <TextField label="PIN" value={pin} onChange={setPin} type="password" inputMode="numeric" maxLength={6} hint="4 to 6 digits" />
        <ChipRow value={role} onChange={setRole} options={ROLE_OPTIONS} />
        <p className="muted">{ROLE_HINT[role]}</p>
        <ErrorNotice error={save.error} />
        <button
          type="button"
          className="btn btn-block btn-lg"
          disabled={save.busy || name.trim().length < 2 || phone.trim().length < 10 || !/^\d{4,6}$/.test(pin)}
          onClick={() => void save.run()}
        >
          {save.busy ? 'Saving…' : 'Add'}
        </button>
      </div>
    </Sheet>
  );
}
