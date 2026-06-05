export interface ShortcutKeyboardEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type KeybindingEventType = 'keydown' | 'keyup';

export interface KeybindingRegistration {
  type?: KeybindingEventType;
  capture?: boolean;
  priority?: number;
  isEnabled?: () => boolean;
  handler: (event: KeyboardEvent) => void;
}

interface KeybindingEntry {
  id: number;
  type: KeybindingEventType;
  capture: boolean;
  priority: number;
  isEnabled: () => boolean;
  handler: (event: KeyboardEvent) => void;
}

class KeybindingService {
  private nextId = 1;
  private entries = new Map<number, KeybindingEntry>();
  private listenersAttached = false;

  register(registration: KeybindingRegistration): () => void {
    const id = this.nextId++;
    const entry: KeybindingEntry = {
      id,
      type: registration.type ?? 'keydown',
      capture: registration.capture ?? false,
      priority: registration.priority ?? 0,
      isEnabled: registration.isEnabled ?? (() => true),
      handler: registration.handler,
    };

    this.entries.set(id, entry);
    this.attachListenersIfNeeded();

    return () => {
      this.entries.delete(id);
      this.detachListenersIfUnused();
    };
  }

  private attachListenersIfNeeded(): void {
    if (this.listenersAttached || typeof window === 'undefined') {
      return;
    }

    window.addEventListener('keydown', this.handleKeydownCapture, true);
    window.addEventListener('keydown', this.handleKeydownBubble);
    window.addEventListener('keyup', this.handleKeyupCapture, true);
    window.addEventListener('keyup', this.handleKeyupBubble);
    this.listenersAttached = true;
  }

  private detachListenersIfUnused(): void {
    if (!this.listenersAttached || this.entries.size > 0 || typeof window === 'undefined') {
      return;
    }

    window.removeEventListener('keydown', this.handleKeydownCapture, true);
    window.removeEventListener('keydown', this.handleKeydownBubble);
    window.removeEventListener('keyup', this.handleKeyupCapture, true);
    window.removeEventListener('keyup', this.handleKeyupBubble);
    this.listenersAttached = false;
  }

  private dispatch(type: KeybindingEventType, capture: boolean, event: KeyboardEvent): void {
    const relevantEntries = Array.from(this.entries.values())
      .filter((entry) => entry.type === type && entry.capture === capture)
      .sort((a, b) => b.priority - a.priority);

    for (const entry of relevantEntries) {
      if (!entry.isEnabled()) {
        continue;
      }

      entry.handler(event);
      if (event.cancelBubble) {
        break;
      }
    }
  }

  private handleKeydownCapture = (event: KeyboardEvent): void => {
    this.dispatch('keydown', true, event);
  };

  private handleKeydownBubble = (event: KeyboardEvent): void => {
    this.dispatch('keydown', false, event);
  };

  private handleKeyupCapture = (event: KeyboardEvent): void => {
    this.dispatch('keyup', true, event);
  };

  private handleKeyupBubble = (event: KeyboardEvent): void => {
    this.dispatch('keyup', false, event);
  };
}

export const keybindingService = new KeybindingService();

const isPrimaryModifierPressed = (event: ShortcutKeyboardEvent): boolean => event.metaKey || event.ctrlKey;
const isPlainKeyPress = (event: ShortcutKeyboardEvent): boolean => !event.metaKey && !event.ctrlKey && !event.altKey;
const normalizedKey = (event: ShortcutKeyboardEvent): string => event.key.toLowerCase();
const hasModalOpen = (): boolean =>
  typeof document !== 'undefined' && document.querySelector('.modal-backdrop') !== null;
const hasArticleViewOpen = (): boolean => {
  if (typeof document === 'undefined') return false;
  
  // Standalone window mode: ArticleView is the main content
  if (document.querySelector('.article-view-window')) return true;
  
  // Embedded mode: check if the app container has the active class
  return document.querySelector('.app-container.article-view-active') !== null;
};

export type ShortcutPriorityLayer = 'modal' | 'article' | 'app';

export const getShortcutPriorityLayer = (): ShortcutPriorityLayer => {
  if (hasModalOpen()) return 'modal';
  if (hasArticleViewOpen()) return 'article';
  return 'app';
};

const isAppShortcutLayerActive = (): boolean => !hasModalOpen();
const isArticleShortcutLayerActive = (): boolean => !hasModalOpen() && hasArticleViewOpen();
const isScrollableShortcutLayerActive = (): boolean => !hasModalOpen();

export const SHORTCUT_LABELS = {
  ADD_FEED: 'Cmd + N',
  OPEN_FEED_EDIT_VIEW: 'Cmd + E',
  REFRESH_FEED: 'Cmd + R',
  SEARCH_ARTICLES: 'Cmd + F',
  OPEN_SETTINGS: 'Cmd + ,',
  OPEN_ARTICLE_IN_NEW_WINDOW: 'N',
  CLOSE_ARTICLE_VIEW: 'Esc',
  CLOSE_ARTICLE_VIEW_ALT: 'Cmd + W',
  SAVE_ARTICLE: 'S',
  TOGGLE_READER_MODE: 'I',
  OPEN_IN_BROWSER: 'O',
  COPY_ARTICLE_URL: 'Y',
  LOAD_FROM_CLIPBOARD: 'P',
  VIM_SCROLL_TOP: 'gg',
  VIM_SCROLL_BOTTOM: 'G',
  VIM_SCROLL_HALF_DOWN: 'Ctrl + D',
  VIM_SCROLL_HALF_UP: 'Ctrl + U',
  RESET_SETTINGS: 'Cmd + Shift + R',
} as const;

export const SHORTCUT_HINTS = {
  CLOSE_ARTICLE_VIEW: `${SHORTCUT_LABELS.CLOSE_ARTICLE_VIEW} or ${SHORTCUT_LABELS.CLOSE_ARTICLE_VIEW_ALT}`,
} as const;

export const withShortcutHint = (label: string, shortcut: string): string =>
  `${label} (${shortcut})`;

export const isOpenSettingsShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isAppShortcutLayerActive() && isPrimaryModifierPressed(event) && event.key === ',';

export const isResetSettingsShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isAppShortcutLayerActive() && isPrimaryModifierPressed(event) && event.shiftKey && normalizedKey(event) === 'r';

export const isClearConfigsShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isAppShortcutLayerActive() && isPrimaryModifierPressed(event) && event.shiftKey && normalizedKey(event) === 'c';

export const isRefreshCurrentFeedShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isAppShortcutLayerActive() && isPrimaryModifierPressed(event) && !event.shiftKey && normalizedKey(event) === 'r';

export const isOpenAddFeedShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isAppShortcutLayerActive() && isPrimaryModifierPressed(event) && normalizedKey(event) === 'n';

export const isOpenFeedEditViewShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isAppShortcutLayerActive() && isPrimaryModifierPressed(event) && normalizedKey(event) === 'e';

export const isCloseOnEscapeShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isAppShortcutLayerActive() && event.key === 'Escape';

export const isModalCloseShortcut = (event: ShortcutKeyboardEvent): boolean =>
  event.key === 'Escape' || (isPrimaryModifierPressed(event) && normalizedKey(event) === 'w');

export const isCloseArticleViewShortcut = (event: ShortcutKeyboardEvent): boolean => {
  if (!isArticleShortcutLayerActive()) return false;
  const isEscOrArrowLeft = event.key === 'Escape' || event.key === 'ArrowLeft';
  const isCmdW = isPrimaryModifierPressed(event) && normalizedKey(event) === 'w';
  return isEscOrArrowLeft || isCmdW;
};

export const isOpenInBrowserShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isArticleShortcutLayerActive() && isPlainKeyPress(event) && normalizedKey(event) === 'o';

export const isCopyArticleUrlShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isArticleShortcutLayerActive() && isPlainKeyPress(event) && normalizedKey(event) === 'y';

export const isOpenInNewWindowShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isArticleShortcutLayerActive() && isPlainKeyPress(event) && normalizedKey(event) === 'n';

export const isToggleReaderModeShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isArticleShortcutLayerActive() && isPlainKeyPress(event) && normalizedKey(event) === 'i';

export const isSaveArticleShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isArticleShortcutLayerActive() && isPlainKeyPress(event) && normalizedKey(event) === 's';

export const isLoadFromClipboardShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isArticleShortcutLayerActive() && isPlainKeyPress(event) && normalizedKey(event) === 'p';

export const isArticleListSearchShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isAppShortcutLayerActive() && isPrimaryModifierPressed(event) && normalizedKey(event) === 'f';

export const isOpenArticleShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isAppShortcutLayerActive() && event.key === 'ArrowRight';

export const isScrollDownShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isAppShortcutLayerActive() && event.key === 'ArrowDown';

export const isScrollUpShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isAppShortcutLayerActive() && event.key === 'ArrowUp';

export const isVimScrollTopKey = (event: ShortcutKeyboardEvent): boolean =>
  isScrollableShortcutLayerActive() && isPlainKeyPress(event) && !event.shiftKey && normalizedKey(event) === 'g';

export const isVimScrollBottomShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isScrollableShortcutLayerActive() && !event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && normalizedKey(event) === 'g';

export const isVimScrollHalfDownShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isScrollableShortcutLayerActive() && !event.metaKey && event.ctrlKey && !event.altKey && !event.shiftKey && normalizedKey(event) === 'd';

export const isVimScrollHalfUpShortcut = (event: ShortcutKeyboardEvent): boolean =>
  isScrollableShortcutLayerActive() && !event.metaKey && event.ctrlKey && !event.altKey && !event.shiftKey && normalizedKey(event) === 'u';
