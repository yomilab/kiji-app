import { getCurrentWindow } from '@tauri-apps/api/window';

export function safeUnlisten(dispose: (() => void) | null | undefined): void {
  if (!dispose) {
    return;
  }

  try {
    dispose();
  } catch {
    // Tauri may throw if the listener was never fully registered or already removed.
  }
}

export function createDeferredUnsubscribe(unlistenPromise: Promise<() => void>): () => void {
  let disposed = false;
  let unlisten: (() => void) | null = null;

  void unlistenPromise
    .then((dispose) => {
      if (disposed) {
        safeUnlisten(dispose);
        return;
      }
      unlisten = dispose;
    })
    .catch(() => {
      // Listener setup failures are surfaced by the caller path when needed.
    });

  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    safeUnlisten(unlisten);
    unlisten = null;
  };
}

export function subscribeToWindowFocus(onFocused: () => void): () => void {
  if (!('__TAURI_INTERNALS__' in window)) {
    return () => {};
  }

  let disposed = false;
  let unlistenFocus: (() => void) | null = null;

  void getCurrentWindow()
    .onFocusChanged(({ payload: focused }) => {
      if (focused) {
        onFocused();
      }
    })
    .then((unlisten) => {
      if (disposed) {
        safeUnlisten(unlisten);
        return;
      }
      unlistenFocus = unlisten;
    })
    .catch((error: unknown) => {
      console.error('Error subscribing to window focus changes:', error);
    });

  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    safeUnlisten(unlistenFocus);
    unlistenFocus = null;
  };
}
