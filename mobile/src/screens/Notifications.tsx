import { useNavigate } from 'react-router-dom';
import { TopBar } from '../components/AppShell';
import { Empty, ErrorNotice, Loading, Screen } from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { dateTimeLabel } from '../lib/format';
import type { Notification } from '../lib/types';

const ICONS: Record<string, string> = {
  LOW_STOCK: '⚠️',
  OUT_OF_STOCK: '🔴',
  EXPIRY: '⏳',
  CUSTOMER_DUE: '💰',
  SUPPLIER_DUE: '📦',
  SCAN_REVIEW: '🧾',
};

/** What the shop should look at, newest first. */
export function Notifications() {
  const navigate = useNavigate();
  const feed = useAsync(
    () => api.get<{ notifications: Notification[] }>('/notifications', { refresh: 'true', limit: 100 }),
    [],
  );

  const openTarget = async (item: Notification) => {
    await api.post(`/notifications/${item.id}/read`).catch(() => undefined);
    if (item.refType === 'ProductVariant' && item.refId) navigate(`/stock/${item.refId}`);
    else if (item.refType === 'Customer' && item.refId) navigate(`/customers/${item.refId}`);
    else if (item.refType === 'Supplier' && item.refId) navigate(`/suppliers/${item.refId}`);
    else if (item.refType === 'ImageScan' && item.refId) navigate(`/scanner/${item.refId}`);
    else feed.reload();
  };

  return (
    <>
      <TopBar
        title="Alerts"
        back
        actions={
          <button
            type="button"
            className="icon-button"
            aria-label="Mark all read"
            onClick={async () => {
              await api.post('/notifications/read-all').catch(() => undefined);
              feed.reload();
            }}
          >
            ✓
          </button>
        }
      />
      <Screen>
        <ErrorNotice error={feed.error} onRetry={feed.reload} />
        {feed.loading ? <Loading /> : null}
        {feed.data && !feed.data.notifications.length ? (
          <Empty icon="🔔" title="Nothing to report" hint="Low stock, dues and expiry warnings will appear here." />
        ) : null}
        {feed.data?.notifications.length ? (
          <div className="list">
            {feed.data.notifications.map((item) => (
              <button
                key={item.id}
                type="button"
                className="list-item"
                onClick={() => void openTarget(item)}
                style={item.isRead ? { opacity: 0.6 } : undefined}
              >
                <div className="avatar">{ICONS[item.type] ?? '🔔'}</div>
                <div className="li-main">
                  <div className="li-title">{item.title}</div>
                  <div className="li-sub">{item.body}</div>
                  <div className="li-sub">{dateTimeLabel(item.createdAt)}</div>
                </div>
                <span className="chev">›</span>
              </button>
            ))}
          </div>
        ) : null}
      </Screen>
    </>
  );
}
