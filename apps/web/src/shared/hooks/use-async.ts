import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/shared/api-client";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  /** Первичная загрузка — данных ещё нет. */
  loading: boolean;
  /** Фоновое обновление — данные уже показаны. */
  refreshing: boolean;
  reload: () => void;
  setData: (updater: T | ((prev: T | null) => T)) => void;
}

/**
 * Загрузка данных с единым жизненным циклом: loading → data | error, повтор,
 * отмена устаревших ответов. `deps` — как у useEffect.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[] = []): AsyncState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const hasData = data !== null;

  useEffect(() => {
    let cancelled = false;
    if (hasData) setRefreshing(true);
    else setLoading(true);
    setError(null);

    fnRef
      .current()
      .then((res) => {
        if (cancelled) return;
        setDataState(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Неизвестная ошибка",
        );
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback(
    (updater: T | ((prev: T | null) => T)) =>
      setDataState((prev) => (typeof updater === "function" ? (updater as (p: T | null) => T)(prev) : updater)),
    [],
  );

  return { data, error, loading, refreshing, reload, setData };
}
