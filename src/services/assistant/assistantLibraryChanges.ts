import { listen } from '@tauri-apps/api/event';
import { logger } from '@/services/logger';
import { recordRobustnessEvent } from '@/services/diagnostics/robustnessMetrics';

/**
 * Library changes an assistant made through Yomi Reader's write tools (Settings →
 * Assistant → Allow assistants to make changes). Native has already persisted
 * every field, including feed counts; windows only apply the change to what
 * they show and never write these fields again (one writer per field).
 */
export const ASSISTANT_LIBRARY_CHANGED_EVENT = 'assistant-library-changed';

export interface AssistantArticleChange {
  hash: string;
  read?: boolean;
  starred?: boolean;
  saved?: boolean;
  savedArticleId?: string;
}

export interface AssistantFeedCounts {
  feedId: string;
  unreadCount: number;
  articleCount: number;
}

export interface AssistantLibraryChange {
  articles: AssistantArticleChange[];
  feedCounts: AssistantFeedCounts[];
  /** Saved snapshots this change created (for the Saved view). */
  savedArticleIds: string[];
}

export type AssistantArticleListUpdate = Partial<Pick<AssistantArticleChange, 'read' | 'starred' | 'saved' | 'savedArticleId'>>;

type Listener = (change: AssistantLibraryChange) => void | Promise<void>;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const optionalBoolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

/** Validates the native payload; malformed entries are dropped. */
export function parseAssistantLibraryChange(payload: unknown): AssistantLibraryChange | null {
  if (!isRecord(payload)) return null;
  const articles: AssistantArticleChange[] = [];
  for (const entry of Array.isArray(payload.articles) ? payload.articles : []) {
    if (!isRecord(entry) || typeof entry.hash !== 'string' || entry.hash.length === 0) continue;
    const change: AssistantArticleChange = { hash: entry.hash };
    const read = optionalBoolean(entry.read);
    const starred = optionalBoolean(entry.starred);
    const saved = optionalBoolean(entry.saved);
    if (read !== undefined) change.read = read;
    if (starred !== undefined) change.starred = starred;
    if (saved !== undefined) change.saved = saved;
    if (typeof entry.savedArticleId === 'string') change.savedArticleId = entry.savedArticleId;
    articles.push(change);
  }
  const feedCounts: AssistantFeedCounts[] = [];
  for (const entry of Array.isArray(payload.feedCounts) ? payload.feedCounts : []) {
    if (
      isRecord(entry)
      && typeof entry.feedId === 'string'
      && typeof entry.unreadCount === 'number'
      && typeof entry.articleCount === 'number'
    ) {
      feedCounts.push({ feedId: entry.feedId, unreadCount: entry.unreadCount, articleCount: entry.articleCount });
    }
  }
  const savedArticleIds = (Array.isArray(payload.savedArticleIds) ? payload.savedArticleIds : [])
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (articles.length === 0 && feedCounts.length === 0 && savedArticleIds.length === 0) return null;
  return { articles, feedCounts, savedArticleIds };
}

/** The list-row fields an article change sets. */
export function toArticleListUpdate(change: AssistantArticleChange): AssistantArticleListUpdate {
  const updates: AssistantArticleListUpdate = {};
  if (change.read !== undefined) updates.read = change.read;
  if (change.starred !== undefined) updates.starred = change.starred;
  if (change.saved !== undefined) {
    updates.saved = change.saved;
    updates.savedArticleId = change.saved ? change.savedArticleId : undefined;
  }
  return updates;
}

const listeners = new Set<Listener>();
let unlisten: (() => void) | null = null;
let starting = false;

const isTauriRuntime = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function reportFailure(message: string, error: unknown): void {
  recordRobustnessEvent('assistant.libraryChangeFailed');
  logger.warn('AssistantLibraryChanges', message, { error });
}

/** Delivers one change to every subscriber; each subscriber fails alone. */
export function dispatchAssistantLibraryChange(payload: unknown): void {
  const change = parseAssistantLibraryChange(payload);
  if (!change) return;
  for (const listener of [...listeners]) {
    try {
      const result = listener(change);
      if (result && typeof (result as Promise<void>).then === 'function') {
        void (result as Promise<void>).catch((error) => reportFailure('Applying an assistant change failed', error));
      }
    } catch (error) {
      reportFailure('Applying an assistant change failed', error);
    }
  }
}

function ensureNativeListener(): void {
  if (unlisten || starting || !isTauriRuntime()) return;
  starting = true;
  void listen<unknown>(ASSISTANT_LIBRARY_CHANGED_EVENT, (event) => dispatchAssistantLibraryChange(event.payload))
    .then((dispose) => {
      starting = false;
      if (listeners.size === 0) {
        dispose();
        return;
      }
      unlisten = dispose;
    })
    .catch((error) => {
      starting = false;
      reportFailure('Listening for assistant changes failed', error);
    });
}

/**
 * Subscribes to assistant changes in this window. One native listener per
 * window, shared by subscribers and dropped when the last one leaves.
 */
export function subscribeAssistantLibraryChanges(listener: Listener): () => void {
  listeners.add(listener);
  ensureNativeListener();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unlisten) {
      unlisten();
      unlisten = null;
    }
  };
}
