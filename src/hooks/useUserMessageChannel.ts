import { useSyncExternalStore } from 'react';
import { userMessageBus, type UserMessage } from '@/services/ui/userMessageBus';

export const useUserMessage = (channel: string): UserMessage | null => useSyncExternalStore(
  (listener): (() => void) => userMessageBus.subscribe(listener),
  (): ReturnType<typeof userMessageBus.getMessage> => userMessageBus.getMessage(channel),
  (): null => null
);

export const useUserMessageChannel = (channel: string): string | null => {
  const message = useUserMessage(channel);

  return message?.text ?? null;
};
