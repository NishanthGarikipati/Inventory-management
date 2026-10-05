import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '../store/session';
import { useToasts } from '../lib/toast';

const TABS = [
  { to: '/', icon: '🏠', label: 'HOME' },
  { to: '/sell', icon: '🛒', label: 'SELL' },
  { to: '/stock', icon: '📦', label: 'STOCK' },
  { to: '/more', icon: '⋯', label: 'MORE' },
];

export function TabBar() {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="tab-icon" aria-hidden>
            {tab.icon}
          </span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function ConnectionPill() {
  const connection = useSession((state) => state.connection);
  const pending = useSession((state) => state.pending);

  const map = {
    ONLINE: { className: '', text: 'Online' },
    OFFLINE: { className: 'offline', text: 'Offline' },
    SYNCING: { className: 'syncing', text: 'Syncing' },
    SYNC_ERROR: { className: 'error', text: 'Sync problem' },
  } as const;
  const state = map[connection];

  return (
    <span className={`connection-pill ${state.className}`}>
      <span className="led" />
      {pending > 0 ? `${state.text} · ${pending} waiting` : state.text}
    </span>
  );
}

export function TopBar({
  title,
  subtitle,
  back,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: boolean;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header className="topbar">
      {back ? (
        <button type="button" className="icon-button" aria-label="Go back" onClick={() => navigate(-1)}>
          ←
        </button>
      ) : null}
      <div className="topbar-title">
        <h1>{title}</h1>
        {subtitle ? <div className="topbar-subtitle">{subtitle}</div> : null}
      </div>
      {actions}
    </header>
  );
}

export function ToastHost() {
  const toasts = useToasts((state) => state.toasts);
  const dismiss = useToasts((state) => state.dismiss);
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((item) => (
        <div key={item.id} className={`toast ${item.tone}`} onClick={() => dismiss(item.id)} role="presentation">
          {item.message}
        </div>
      ))}
    </div>
  );
}

export function AppShell() {
  return (
    <div className="app-shell">
      <main className="app-main">
        <Outlet />
      </main>
      <TabBar />
      <ToastHost />
    </div>
  );
}
