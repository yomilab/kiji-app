const asyncNoop = async (): Promise<void> => {};

const currentWindow = {
  label: 'storybook',
  startDragging: asyncNoop,
  toggleMaximize: asyncNoop,
  close: asyncNoop,
};

export function getCurrentWindow() {
  return currentWindow;
}

/** Read-only answers for the few native calls a story renders (Settings → General). */
const STORY_INVOKE_RESULTS: Record<string, unknown> = {
  shell_background_mode_get: { enabled: true, platform: 'macos', trayReady: false },
  shell_attention_get: {
    showUnreadBadge: true,
    notifyNewArticles: false,
    badgeSupported: true,
    notificationsBlocked: false,
  },
};

export async function invoke<T>(command: string): Promise<T> {
  if (command in STORY_INVOKE_RESULTS) {
    return STORY_INVOKE_RESULTS[command] as T;
  }
  throw new Error(`Unexpected Tauri invoke from Storybook: ${command}`);
}

export async function listen() {
  return asyncNoop;
}

