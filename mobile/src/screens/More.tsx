import { useNavigate } from 'react-router-dom';
import { TopBar } from '../components/AppShell';
import { Card, Screen } from '../components/ui';
import { useSession } from '../store/session';

interface Entry {
  to: string;
  icon: string;
  label: string;
  hint: string;
  permission?: string;
}

const GROUPS: Array<{ title: string; entries: Entry[] }> = [
  {
    title: 'Shop',
    entries: [
      { to: '/products', icon: '🏷️', label: 'Products', hint: 'Prices, barcodes, variants', permission: 'product:read' },
      { to: '/purchases', icon: '📥', label: 'Purchases', hint: 'Goods you bought', permission: 'purchase:read' },
      { to: '/scanner', icon: '📷', label: 'Scanner', hint: 'Read an invoice or label', permission: 'scanner:use' },
      { to: '/returns', icon: '↩️', label: 'Returns', hint: 'Customer and supplier returns', permission: 'sale:read' },
    ],
  },
  {
    title: 'People',
    entries: [
      { to: '/customers', icon: '👥', label: 'Customers', hint: 'Money due, history', permission: 'customer:read' },
      { to: '/suppliers', icon: '🚚', label: 'Suppliers', hint: 'Supplier due, history', permission: 'supplier:read' },
      { to: '/payments', icon: '💵', label: 'Payments', hint: 'Take and pay money', permission: 'payment:create' },
    ],
  },
  {
    title: 'Money',
    entries: [
      { to: '/expenses', icon: '🧾', label: 'Expenses', hint: 'Rent, salary, transport', permission: 'expense:read' },
      { to: '/closing', icon: '🌙', label: 'Close the Day', hint: 'Count the cash box', permission: 'report:read' },
      { to: '/reports', icon: '📊', label: 'Reports', hint: 'Sales, stock, profit', permission: 'report:read' },
      { to: '/sales', icon: '🧮', label: 'Bills', hint: 'Every bill you made', permission: 'sale:read' },
    ],
  },
];

export function More() {
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const business = useSession((state) => state.business);
  const user = useSession((state) => state.user);
  const signOut = useSession((state) => state.signOut);
  const pending = useSession((state) => state.pending);

  return (
    <>
      <TopBar title="More" subtitle={business?.name} />
      <Screen>
        {GROUPS.map((group) => {
          const entries = group.entries.filter((entry) => !entry.permission || can(entry.permission));
          if (!entries.length) return null;
          return (
            <Card key={group.title} title={group.title} flush>
              <div className="list">
                {entries.map((entry) => (
                  <button key={entry.to} type="button" className="list-item" onClick={() => navigate(entry.to)}>
                    <div className="avatar">{entry.icon}</div>
                    <div className="li-main">
                      <div className="li-title">{entry.label}</div>
                      <div className="li-sub">{entry.hint}</div>
                    </div>
                    <span className="chev">›</span>
                  </button>
                ))}
              </div>
            </Card>
          );
        })}

        <Card title="App" flush>
          <div className="list">
            <button type="button" className="list-item" onClick={() => navigate('/settings')}>
              <div className="avatar">⚙️</div>
              <div className="li-main">
                <div className="li-title">Settings</div>
                <div className="li-sub">Shop details, tax, staff</div>
              </div>
              <span className="chev">›</span>
            </button>
            <button type="button" className="list-item" onClick={() => navigate('/pending')}>
              <div className="avatar">📤</div>
              <div className="li-main">
                <div className="li-title">Waiting to sync</div>
                <div className="li-sub">{pending ? `${pending} saved on this phone` : 'Everything is sent'}</div>
              </div>
              <span className="chev">›</span>
            </button>
          </div>
        </Card>

        <Card>
          <div className="row-between">
            <div>
              <strong>{user?.name}</strong>
              <div className="li-sub">{user?.role === 'OWNER' ? 'Owner' : user?.role === 'MANAGER' ? 'Manager' : 'Cashier'}</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </Card>
      </Screen>
    </>
  );
}
