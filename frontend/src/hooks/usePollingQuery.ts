import { useCallback, useEffect, useRef, useState } from "react";

type PollingOptions<T> = {
  initialData: T;
  intervalMs: number;
  hiddenIntervalMs?: number | null;
  failureThreshold?: number;
  enabled?: boolean;
  keepDataOnError?: boolean;
};

type RefetchOptions = {
  force?: boolean;
};

export type PollingState<T> = {
  data: T;
  loading: boolean;
  error: string | null;
  failureCount: number;
  lastUpdated: Date | null;
  refetch: (options?: RefetchOptions) => Promise<void>;
};

function getErrorText(failureCount: number, threshold: number): string {
  return failureCount >= threshold ? "连接异常" : "后端连接失败";
}

export function usePollingQuery<T>(fetcher: () => Promise<T>, options: PollingOptions<T>): PollingState<T> {
  const {
    initialData,
    intervalMs,
    hiddenIntervalMs = null,
    failureThreshold = 3,
    enabled = true,
    keepDataOnError = true
  } = options;
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [failureCount, setFailureCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const inFlightPromiseRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(false);
  const fetcherRef = useRef(fetcher);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const runFetch = useCallback(async () => {
    try {
      const nextData = await fetcherRef.current();
      if (!mountedRef.current) {
        return;
      }
      setData(nextData);
      setError(null);
      setFailureCount(0);
      setLastUpdated(new Date());
    } catch {
      if (!mountedRef.current) {
        return;
      }
      setFailureCount((current) => {
        const nextCount = current + 1;
        setError(getErrorText(nextCount, failureThreshold));
        return nextCount;
      });
      if (!keepDataOnError) {
        setData(initialData);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
      inFlightPromiseRef.current = null;
    }
  }, [failureThreshold, initialData, keepDataOnError]);

  const refetch = useCallback(async (refetchOptions: RefetchOptions = {}) => {
    if (!enabled) {
      return;
    }

    if (inFlightPromiseRef.current) {
      const activeRequest = inFlightPromiseRef.current;
      if (!refetchOptions.force) {
        await activeRequest;
        return;
      }

      await activeRequest.catch(() => undefined);
      if (inFlightPromiseRef.current) {
        await inFlightPromiseRef.current;
        return;
      }
    }

    const request = runFetch();
    inFlightPromiseRef.current = request;
    await request;
  }, [enabled, runFetch]);

  useEffect(() => {
    if (!enabled) {
      clearTimer();
      setLoading(false);
      return undefined;
    }

    let disposed = false;

    const schedule = () => {
      if (disposed) {
        return;
      }

      clearTimer();
      const hidden = document.visibilityState === "hidden";
      const nextInterval = hidden ? hiddenIntervalMs : intervalMs;
      if (nextInterval === null) {
        return;
      }

      timerRef.current = window.setTimeout(async () => {
        await refetch();
        schedule();
      }, nextInterval);
    };

    void refetch().finally(schedule);
    const handleVisibilityChange = () => schedule();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearTimer();
    };
  }, [clearTimer, enabled, hiddenIntervalMs, intervalMs, refetch]);

  return {
    data,
    loading,
    error,
    failureCount,
    lastUpdated,
    refetch
  };
}
