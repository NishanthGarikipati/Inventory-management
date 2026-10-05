import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAsync } from '../hooks/useAsync';
import { money, moneyShort } from '../lib/format';
import { useSession } from '../store/session';
import { ConnectionPill, TopBar } from '../components/AppShell';
import { Card, ErrorNotice, Loading, Screen, StatTile } from '../components/ui';
import type { DashboardData, Notification } from '../lib/types';

/**
 * The first thing the owner sees: what happened today, what needs attention,
 * and the four things they open the app to do.
 */
export function Home() {
  const navigate = useNavigate();
  const business = useSession((state) => state.business);
  const user = useSession((state) => state.user);
  const can = useSession((state) => state.can);
  const pending = useSession((state) => state.pending);
  const connection = useSession((state) => state.connection);

  const dashboard = useAsync(() => api.get<DashboardData>('/dashboard'), [connection === 'ONLINE']);
  const unread = useAsync(
    () => api.get<{ notifications: Notification[] }>('/notifications', { unreadOnly: 'true', limit: 20 }),
    [],
  );

  const data = dashboard.data;
  const alerts = data?.alerts;

  return (
    <>
      <TopBar
        title={business?.name ?? 'My Shop'}
        subtitle={<ConnectionPill />}
        actions={
          <>
            <button type="button" className="icon-button" aria-label="Search" onClick={() => navigate('/search')}>
              🔍
            </button>
            <button type="button" className="icon-button" aria-label="Notifications" onClick={() => navigate('/notifications')}>
              🔔
              {unread.data?.notifications.length ? <span className="dot">{unread.data.notifications.length}</span> : null}
            </button>
          </>
        }
      />

      <Screen>
        <div>
          <h2>
            {data?.greeting ?? 'Hello'} 👋
          </h2>
          <p className="muted">{user?.name}</p>
        </div>

        {pending > 0 ? (
          <button type="button" className="banner info" onClick={() => navigate('/pending')} style={{ textAlign: 'left' }}>
            <span>📤</span>
            <div className="grow">
              {pending} {pending === 1 ? 'entry is' : 'entries are'} saved on this phone and will be sent when you are online.
            </div>
          </button>
        ) : null}

        {dashboard.loading && !data ? <Loading label="Getting today's numbers…" /> : null}
        <ErrorNotice error={dashboard.error} onRetry={dashboard.reload} />

        {data ? (
          <>
            <div className="stat-grid">
              <StatTile
                label="Today's Sales"
                value={money(data.today.salesPaise)}
                note={`${data.today.billCount} ${data.today.billCount === 1 ? 'bill' : 'bills'}`}
                accent
                onClick={() => navigate('/sales')}
              />
              <StatTile
                label="Estimated Gross Profit"
                value={money(data.today.grossProfitPaise)}
                note="Before expenses"
                onClick={() => navigate('/reports/profit')}
              />
              <StatTile
                label="Today's Purchases"
                value={money(data.today.purchasesPaise)}
                onClick={() => navigate('/purchases')}
              />
              <StatTile label="Today's Expenses" value={money(data.today.expensesPaise)} onClick={() => navigate('/expenses')} />
            </div>

            <Card title="Needs your attention" flush>
              <div>
                {alerts?.lowStock ? (
                  <AlertRow
                    icon="⚠️"
                    title={`${alerts.lowStock} Low Stock`}
                    sub="Running out soon"
                    onClick={() => navigate('/stock?status=LOW_STOCK')}
                  />
                ) : null}
                {alerts?.outOfStock ? (
                  <AlertRow
                    icon="🔴"
                    title={`${alerts.outOfStock} Out of Stock`}
                    sub="Nothing left to sell"
                    onClick={() => navigate('/stock?status=OUT_OF_STOCK')}
                  />
                ) : null}
                {alerts?.expiringSoon ? (
                  <AlertRow
                    icon="⏳"
                    title={`${alerts.expiringSoon} Expiring Soon`}
                    sub="Check batches"
                    onClick={() => navigate('/stock?status=EXPIRING_SOON')}
                  />
                ) : null}
                {alerts?.customerDuePaise ? (
                  <AlertRow
                    icon="💰"
                    title={`${money(alerts.customerDuePaise)} Customer Due`}
                    sub={`${alerts.customerDueCount} ${alerts.customerDueCount === 1 ? 'customer' : 'customers'}`}
                    onClick={() => navigate('/customers?due=1')}
                  />
                ) : null}
                {alerts?.supplierDuePaise ? (
                  <AlertRow
                    icon="📦"
                    title={`${money(alerts.supplierDuePaise)} Supplier Due`}
                    sub={`${alerts.supplierDueCount} ${alerts.supplierDueCount === 1 ? 'supplier' : 'suppliers'}`}
                    onClick={() => navigate('/suppliers?due=1')}
                  />
                ) : null}
                {alerts?.scansAwaitingReview ? (
                  <AlertRow
                    icon="🧾"
                    title={`${alerts.scansAwaitingReview} scans waiting`}
                    sub="Check what was read from your photos"
                    onClick={() => navigate('/scanner/history')}
                  />
                ) : null}
                {!alerts ||
                (!alerts.lowStock &&
                  !alerts.outOfStock &&
                  !alerts.expiringSoon &&
                  !alerts.customerDuePaise &&
                  !alerts.supplierDuePaise &&
                  !alerts.scansAwaitingReview) ? (
                  <div style={{ padding: '18px 16px' }} className="muted">
                    Everything looks fine today.
                  </div>
                ) : null}
              </div>
            </Card>

            <div className="quick-actions">
              {can('sale:create') ? (
                <button type="button" className="quick-action primary" onClick={() => navigate('/sell')}>
                  <span className="qa-icon">🛒</span>
                  <span className="qa-label">SELL</span>
                </button>
              ) : null}
              {can('purchase:write') ? (
                <button type="button" className="quick-action" onClick={() => navigate('/purchases/new')}>
                  <span className="qa-icon">📥</span>
                  <span className="qa-label">PURCHASE</span>
                </button>
              ) : null}
              {can('scanner:use') ? (
                <button type="button" className="quick-action" onClick={() => navigate('/scanner')}>
                  <span className="qa-icon">📷</span>
                  <span className="qa-label">SCAN INVOICE</span>
                </button>
              ) : null}
              {can('product:write') ? (
                <button type="button" className="quick-action" onClick={() => navigate('/products/new')}>
                  <span className="qa-icon">➕</span>
                  <span className="qa-label">ADD PRODUCT</span>
                </button>
              ) : null}
            </div>

            <div className="stat-grid">
              <StatTile label="Stock Value" value={moneyShort(data.stockValuePaise)} note="At cost" onClick={() => navigate('/stock')} />
              <StatTile
                label="Credit Given Today"
                value={moneyShort(data.today.creditGivenPaise)}
                onClick={() => navigate('/customers?due=1')}
              />
            </div>

            {data.topProducts.length ? (
              <Card title="Selling well this month" flush>
                <div className="list">
                  {data.topProducts.map((product) => (
                    <button
                      key={product.variantId}
                      type="button"
                      className="list-item"
                      onClick={() => navigate(`/stock/${product.variantId}`)}
                    >
                      <div className="li-main">
                        <div className="li-title">{product.name}</div>
                        <div className="li-sub">{product.quantity} sold</div>
                      </div>
                      <div className="li-right">
                        <div className="li-amount">{money(product.revenuePaise)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </Card>
            ) : null}

            {data.highlights.length ? (
              <Card title={`For your ${data.business?.type.toLowerCase().replace(/_/g, ' ') ?? 'shop'}`}>
                <ul style={{ margin: 0, paddingLeft: 18 }} className="muted">
                  {data.highlights.map((highlight) => (
                    <li key={highlight}>{highlight}</li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </>
        ) : null}
      </Screen>
    </>
  );
}

function AlertRow({ icon, title, sub, onClick }: { icon: string; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" className="alert-row" onClick={onClick}>
      <span className="alert-icon">{icon}</span>
      <span className="alert-text">
        <strong>{title}</strong>
        <span>{sub}</span>
      </span>
      <span className="chev">›</span>
    </button>
  );
}
