import { useSyncExternalStore } from 'react';
import { userMessageBus } from '@/services/ui/userMessageBus';

export const useUserMessageChannel = (channel: string): string | null => {
  const message = useSyncExternalStore(
    (listener): (() => void) => userMessageBus.subscribe(listener),
    (): ReturnType<typeof userMessageBus.getMessage> => userMessageBus.getMessage(channel),
    (): null => null
  );

  return message?.text ?? null;
};
