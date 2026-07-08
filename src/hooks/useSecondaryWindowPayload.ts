import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { createDeferredUnsubscribe } from '@/services/tauri/tauriEventSubscription';
import { logger } from '@/services/logger';

interface UseSecondaryWindowPayloadOptions<T> {
  eventName: string;
  loadPayload: () => Promise<T>;
  logCategory: string;
  emptyMessage: string;
}

export function useSecondaryWindowPayload<T>({
  eventName,
  loadPayload,
  logCategory,
  emptyMessage,
}: UseSecondaryWindowPayloadOptions<T>) {
  const [payload, setPayload] = useState<T | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const loadPayloadRef = useRef(loadPayload);

  useEffect(() => {
    loadPayloadRef.current = loadPayload;
  }, [loadPayload]);

  useEffect(() => {
    let mounted = true;

    const reload = () => {
      setErrorMessage(null);
      void loadPayloadRef.current()
        .then((nextPayload) => {
          if (mounted) {
            setPayload(nextPayload);
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(logCategory, emptyMessage, { error: message });
          if (mounted) {
            setPayload(null);
            setErrorMessage(message);
          }
        });
    };

    reload();
    const removeOpenListener = createDeferredUnsubscribe(
      listen(eventName, () => {
        reload();
      }),
    );

    return () => {
      mounted = false;
      removeOpenListener();
    };
  }, [emptyMessage, eventName, logCategory]);

  return { payload, errorMessage };
}
