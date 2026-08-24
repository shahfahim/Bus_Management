import { useCallback, useEffect, useState } from 'react';

export function useRemoteData<T>(loader: (signal: AbortSignal) => Promise<T>, dependencies: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    loader(controller.signal)
      .then((value) => setData(value))
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // Callers provide a stable loader or list every value it closes over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader, version, ...dependencies]);

  return { data, error, loading, reload, setData };
}
