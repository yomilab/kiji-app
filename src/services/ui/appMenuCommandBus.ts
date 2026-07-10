import type { AppMenuCommand } from '@/types/appMenu';

type AppMenuCommandListener = (command: AppMenuCommand) => void;

const listeners = new Set<AppMenuCommandListener>();

export function subscribeAppMenuCommand(listener: AppMenuCommandListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishAppMenuCommand(command: AppMenuCommand): void {
  for (const listener of listeners) {
    listener(command);
  }
}
