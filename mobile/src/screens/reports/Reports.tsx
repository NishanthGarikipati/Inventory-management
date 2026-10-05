import { useNavigate } from 'react-router-dom';
import { TopBar } from '../../components/AppShell';
import { Card, Empty, Screen } from '../../components/ui';
import { useSession } from '../../store/session';
import { REPORTS } from './ReportView';

interface Entry {
  key: string;
  icon: string;
}

/** Titles and descriptions come from the report itself, so they never differ. */
const GROUPS: Array<{ title: string; entries: Entry[] }> = [
  {
    title: 'Sales',
    entries: [
      { key: 'daily-sales', icon: '📈' },
      { key: 'monthly-sales', icon: '🗓️' },
      { key: 'sales-by-product', icon: '🏷️' },
      { key: 'sales-by-category', icon: '📚' },
      { key: 'sales-returns', icon: '↩️' },
    ],
  },
  {
    title: 'Money',
    entries: [
      { key: 'profit', icon: '💹' },
      { key: 'expenses', icon: '🧾' },
      { key: 'payments', icon: '💵' },
      { key: 'purchases', icon: '📥' },
      { key: 'purchase-returns', icon: '↪️' },
    ],
  },
  {
    title: 'Stock',
    entries: [
      { key: 'inventory', icon: '📦' },
      { key: 'low-stock', icon: '⚠️' },
      { key: 'out-of-stock', icon: '🔴' },
      { key: 'stock-movement', icon: '🔁' },
    ],
  },
  {
    title: 'People',
    entries: [
      { key: 'customer-outstanding', icon: '👥' },
      { key: 'supplier-outstanding', icon: '🚚' },
    ],
  },
  {
    title: 'Smart Scanner',
    entries: [{ key: 'scans', icon: '📷' }],
  },
];

/** The menu of reports a shop owner actually asks for, in plain words. */
export function Reports() {
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const business = useSession((state) => state.business);

  if (!can('report:read')) {
    return (
      <>
        <TopBar title="Reports" back />
        <Screen>
          <Empty icon="🔒" title="Reports are not open for you" hint="Ask the owner to give you report access." />
        </Screen>
      </>
    );
  }

  return (
    <>
      <TopBar title="Reports" back subtitle={business?.name} />
      <Screen>
        {GROUPS.map((group) => {
          const entries = group.entries
            .map((entry) => ({ ...entry, report: REPORTS[entry.key] }))
            .filter((entry) => entry.report && can(entry.report.permission));
          if (!entries.length) return null;
          return (
            <Card key={group.title} title={group.title} flush>
              <div className="list">
                {entries.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className="list-item"
                    onClick={() => navigate(`/reports/${entry.key}`)}
                  >
                    <div className="avatar">{entry.icon}</div>
                    <div className="li-main">
                      <div className="li-title">{entry.report.title}</div>
                      <div className="li-sub">{entry.report.description}</div>
                    </div>
                    <span className="chev">›</span>
                  </button>
                ))}
              </div>
            </Card>
          );
        })}

        <p className="muted">
          Every report can be copied as plain text, so you can forward the day's numbers on WhatsApp.
        </p>
      </Screen>
    </>
  );
}
