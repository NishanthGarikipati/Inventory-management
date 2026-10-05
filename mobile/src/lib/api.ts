import type { ErrorAction } from './types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

const ACCESS_TOKEN_KEY = 'dukaan.accessToken';
const REFRESH_TOKEN_KEY = 'dukaan.refreshToken';

/**
 * An error the user can act on. Every failure surfaces a sentence in plain
 * words plus, where the server offered them, the buttons that fix it.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly actions: ErrorAction[] = [],
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the request failed because the phone is offline. */
  get isOffline(): boolean {
    return this.code === 'OFFLINE';
  }
}

export const tokens = {
  get access(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  },
  get refresh(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  },
  set(access: string, refresh?: string) {
    localStorage.setItem(ACCESS_TOKEN_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** Sent as Idempotency-Key so a retry cannot duplicate a transaction. */
  idempotencyKey?: string;
  formData?: FormData;
  signal?: AbortSignal;
  skipAuth?: boolean;
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  const refreshToken = tokens.refresh;
  if (!refreshToken) return false;

  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { accessToken: string; refreshToken: string };
      tokens.set(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function buildUrl(path: string, query?: Query): string {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString().replace(window.location.origin, '');
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (!options.formData) headers['Content-Type'] = 'application/json';
    if (!options.skipAuth && tokens.access) headers.Authorization = `Bearer ${tokens.access}`;
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

    return fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.formData ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      signal: options.signal,
    });
  };

  let response: Response;
  try {
    response = await send();
  } catch {
    throw new ApiError(0, 'OFFLINE', 'You are offline. This will be saved and sent when you are back online.');
  }

  if (response.status === 401 && !options.skipAuth && (await refreshSession())) {
    try {
      response = await send();
    } catch {
      throw new ApiError(0, 'OFFLINE', 'You are offline. This will be saved and sent when you are back online.');
    }
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      throw new ApiError(response.status, 'SERVER_ERROR', 'Something went wrong. Please try again.');
    }
    return (await response.blob()) as T;
  }

  const payload = (await response.json()) as
    | T
    | { error: { code: string; message: string; actions?: ErrorAction[]; details?: unknown } };

  if (!response.ok) {
    const error = (payload as { error?: { code: string; message: string; actions?: ErrorAction[]; details?: unknown } }).error;
    throw new ApiError(
      response.status,
      error?.code ?? 'SERVER_ERROR',
      error?.message ?? 'Something went wrong. Please try again.',
      error?.actions ?? [],
      error?.details,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>(path, { query, signal }),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
    request<T>(path, { method: 'POST', body, idempotencyKey }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', formData }),
};

/** A stable id for a queued transaction, so a replay is recognised as one. */
export const newRequestId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
