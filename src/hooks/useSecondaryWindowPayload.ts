import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { createDeferredUnsubscribe } from '@/services/tauri/tauriEventSubscription';
import { logger } from '@/services/logger';

interface UseSecondaryWindowPayloadOptions<T> {
  eventName: string;
  loadPayload: () => Promise<T>;
  logCategory: string;
  emptyMessage: string;
  /** Fail the payload load if it takes longer than this many milliseconds. */
  timeoutMs?: number;
}

export class PayloadLoadTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms while loading window payload.`);
    this.name = 'PayloadLoadTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new PayloadLoadTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}

export function useSecondaryWindowPayload<T>({
  eventName,
  loadPayload,
  logCategory,
  emptyMessage,
  timeoutMs,
}: UseSecondaryWindowPayloadOptions<T>) {
  const [payload, setPayload] = useState<T | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [retryToken, setRetryToken] = useState(0);
  const loadPayloadRef = useRef(loadPayload);
  const timeoutMsRef = useRef(timeoutMs);
  const loadGenerationRef = useRef(0);

  useEffect(() => {
    loadPayloadRef.current = loadPayload;
  }, [loadPayload]);

  useEffect(() => {
    timeoutMsRef.current = timeoutMs;
  }, [timeoutMs]);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let mounted = true;
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setErrorMessage(null);
    setIsLoading(true);

    const timeout = timeoutMsRef.current;
    const loadPromise = timeout
      ? withTimeout(loadPayloadRef.current(), timeout)
      : loadPayloadRef.current();

    void loadPromise
      .then((nextPayload) => {
        if (!mounted || loadGenerationRef.current !== generation) {
          return;
        }
        setPayload(nextPayload);
        setIsLoading(false);
      })
      .catch((error: unknown) => {
        if (!mounted || loadGenerationRef.current !== generation) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        logger.error(logCategory, emptyMessage, { error: message });
        setPayload(null);
        setErrorMessage(message);
        setIsLoading(false);
      });

    const removeOpenListener = createDeferredUnsubscribe(
      listen(eventName, () => {
        setRetryToken((token) => token + 1);
      }),
    );

    return () => {
      mounted = false;
      removeOpenListener();
    };
  }, [emptyMessage, eventName, logCategory, retryToken, timeoutMs]);

  return { payload, errorMessage, isLoading, retry };
}
