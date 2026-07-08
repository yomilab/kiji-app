const listeners = new Set<() => void>();

let sessionPromptDismissed = false;

export function isUpdatePromptDismissedForSession(): boolean {
  return sessionPromptDismissed;
}

export function dismissUpdatePromptForSession(): void {
  if (sessionPromptDismissed) {
    return;
  }
  sessionPromptDismissed = true;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeUpdatePromptSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
