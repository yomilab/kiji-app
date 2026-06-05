import { useMemo, useRef, useState } from 'react';
import { useDependencyEffect, useUnmountEffect } from '@/hooks/useLifecycleEffects';

const NEW_ARTICLE_HIGHLIGHT_MS = 3000;

export const useTransientNewArticleHashes = (
  isSavedView: boolean,
  contextNewArticleHashes: Set<string>
): Set<string> => {
  const [newArticleHashes, setNewArticleHashes] = useState<Set<string>>(new Set());
  const clearTimerRef = useRef<number | null>(null);
  const sortedContextHashes = useMemo(
    () => Array.from(contextNewArticleHashes).sort(),
    [contextNewArticleHashes]
  );
  const contextHashSignature = sortedContextHashes.join('|');

  useDependencyEffect(() => {
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }

    if (isSavedView) {
      setNewArticleHashes(new Set());
      return;
    }

    if (contextNewArticleHashes.size === 0) {
      setNewArticleHashes(new Set());
      return;
    }

    setNewArticleHashes(new Set(sortedContextHashes));
    clearTimerRef.current = window.setTimeout(() => {
      setNewArticleHashes(new Set());
      clearTimerRef.current = null;
    }, NEW_ARTICLE_HIGHLIGHT_MS);
  }, [isSavedView, contextHashSignature]);

  useUnmountEffect(() => {
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
    }
  });

  return newArticleHashes;
};
