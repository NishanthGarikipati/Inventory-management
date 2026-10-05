import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | Error | null;
  reload: () => void;
  setData: (value: T | null) => void;
}

/**
 * Loads a screen's data and re-runs when its inputs change. Errors are kept
 * rather than thrown so every screen can show the sentence the server sent
 * along with the buttons that fix it.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((value) => {
        if (alive.current) setData(value);
      })
      .catch((cause: unknown) => {
        if (alive.current) setError(cause instanceof Error ? cause : new Error('Something went wrong.'));
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { data, loading, error, reload, setData };
}

/** Runs a mutation once at a time and reports failure in the user's words. */
export function useSubmit<Args extends unknown[], R>(action: (...args: Args) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const run = useCallback(
    async (...args: Args): Promise<R | undefined> => {
      if (busy) return undefined;
      setBusy(true);
      setError(null);
      try {
        return await action(...args);
      } catch (cause) {
        setError(cause instanceof Error ? cause : new Error('Something went wrong.'));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, action],
  );

  return { run, busy, error, clearError: () => setError(null) };
}
