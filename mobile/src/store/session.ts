import { create } from 'zustand';
import { api, tokens } from '../lib/api';
import { clearBusinessCache } from '../lib/db';
import { pendingCount, pullCatalogue, pushQueue } from '../lib/sync';
import type { Business, BusinessSettings, SessionUser } from '../lib/types';

export type ConnectionState = 'ONLINE' | 'OFFLINE' | 'SYNCING' | 'SYNC_ERROR';

interface MeResponse {
  user: SessionUser;
  business: Business;
  settings: BusinessSettings;
  permissions: string[];
  features: Record<string, boolean>;
}

interface SessionState {
  status: 'LOADING' | 'SIGNED_OUT' | 'SIGNED_IN';
  user: SessionUser | null;
  business: Business | null;
  settings: BusinessSettings | null;
  permissions: string[];
  features: Record<string, boolean>;
  connection: ConnectionState;
  pending: number;
  lastSyncError: string | null;

  restore: () => Promise<void>;
  signIn: (accessToken: string, refreshToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  sync: (options?: { full?: boolean }) => Promise<void>;
  refreshPending: () => Promise<void>;
  setConnection: (connection: ConnectionState) => void;
  can: (permission: string) => boolean;
  hasFeature: (feature: string) => boolean;
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'LOADING',
  user: null,
  business: null,
  settings: null,
  permissions: [],
  features: {},
  connection: navigator.onLine ? 'ONLINE' : 'OFFLINE',
  pending: 0,
  lastSyncError: null,

  async restore() {
    if (!tokens.access) {
      set({ status: 'SIGNED_OUT' });
      return;
    }
    try {
      await get().refreshMe();
      set({ status: 'SIGNED_IN' });
      void get().sync();
    } catch {
      tokens.clear();
      set({ status: 'SIGNED_OUT' });
    }
  },

  async signIn(accessToken, refreshToken) {
    tokens.set(accessToken, refreshToken);
    await get().refreshMe();
    set({ status: 'SIGNED_IN' });
    await get().sync({ full: true });
  },

  async signOut() {
    const businessId = get().business?.id;
    const refreshToken = tokens.refresh;
    if (refreshToken) {
      try {
        await api.post('/auth/logout', { refreshToken });
      } catch {
        // Signing out locally matters more than telling the server.
      }
    }
    tokens.clear();
    if (businessId) await clearBusinessCache(businessId);
    set({ status: 'SIGNED_OUT', user: null, business: null, settings: null, permissions: [], features: {} });
  },

  async refreshMe() {
    const me = await api.get<MeResponse>('/auth/me');
    set({
      user: me.user,
      business: me.business,
      settings: me.settings,
      permissions: me.permissions,
      features: me.features,
    });
  },

  async sync(options = {}) {
    const businessId = get().business?.id;
    if (!businessId || !navigator.onLine) {
      set({ connection: navigator.onLine ? get().connection : 'OFFLINE' });
      return;
    }

    set({ connection: 'SYNCING', lastSyncError: null });
    try {
      const summary = await pushQueue(businessId);
      await pullCatalogue(businessId, options);
      await get().refreshPending();
      set({
        connection: summary.failed > 0 ? 'SYNC_ERROR' : 'ONLINE',
        lastSyncError: summary.failures[0]?.message ?? null,
      });
    } catch (error) {
      set({
        connection: navigator.onLine ? 'SYNC_ERROR' : 'OFFLINE',
        lastSyncError: error instanceof Error ? error.message : 'Sync failed',
      });
    }
  },

  async refreshPending() {
    const businessId = get().business?.id;
    if (!businessId) return;
    set({ pending: await pendingCount(businessId) });
  },

  setConnection(connection) {
    set({ connection });
  },

  can(permission) {
    return get().permissions.includes(permission);
  },

  hasFeature(feature) {
    return Boolean(get().features[feature]);
  },
}));

/** Keeps the connection badge honest and drains the queue when the line returns. */
export function watchConnection(): () => void {
  const online = () => {
    useSession.getState().setConnection('ONLINE');
    void useSession.getState().sync();
  };
  const offline = () => useSession.getState().setConnection('OFFLINE');

  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  const timer = window.setInterval(() => {
    if (navigator.onLine && useSession.getState().status === 'SIGNED_IN') {
      void useSession.getState().sync();
    }
  }, 60_000);

  return () => {
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
    window.clearInterval(timer);
  };
}
