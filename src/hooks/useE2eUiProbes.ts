import { useEffect, useRef, useState } from 'react';
import {
  useFeedCollection,
  useFeedNavigation,
  useFeedOverlay,
} from '@/contexts/FeedContext';
import {
  type KijiE2eConfig,
  waitForE2eConfig,
  writeE2eEvent,
} from '@/services/e2e/e2eHarness';
import { getRendererWindowType, isMainRendererWindow } from '@/utils/rendererWindow';

export const useE2eUiProbes = (): void => {
  const { articles, articlesTotalCount } = useFeedCollection();
  const { selectedFeedId, selectedTag, navigationNonce } = useFeedNavigation();
  const {
    articleViewOverlayPhase,
    activeArticleHash,
  } = useFeedOverlay();
  const [e2eConfig, setE2eConfig] = useState<KijiE2eConfig | null>(null);
  const shellReadyRef = useRef(false);
  const listSnapshotRef = useRef<string | null>(null);
  const deckPhaseRef = useRef<string | null>(null);
  const navigationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    listSnapshotRef.current = null;
  }, [navigationNonce]);

  useEffect(() => {
    if (!isMainRendererWindow()) {
      return;
    }

    let disposed = false;

    void (async () => {
      const config = await waitForE2eConfig();
      if (!config || disposed) {
        return;
      }

      setE2eConfig(config);
      if (!shellReadyRef.current) {
        shellReadyRef.current = true;
        await writeE2eEvent('main-shell-ready', {
          windowType: getRendererWindowType(),
        });
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!e2eConfig) {
      return;
    }

    const snapshotKey = `${selectedFeedId ?? ''}:${selectedTag ?? ''}:${navigationNonce}:${articles.length}`;
    if (articles.length < 1 || listSnapshotRef.current === snapshotKey) {
      return;
    }

    listSnapshotRef.current = snapshotKey;
    void writeE2eEvent('article-list-snapshot', {
      articleCount: articles.length,
      articlesTotalCount,
      feedId: selectedFeedId,
      selectedFeedId,
      selectedTag,
      navigationNonce,
    });
  }, [articles.length, articlesTotalCount, e2eConfig, navigationNonce, selectedFeedId, selectedTag]);

  useEffect(() => {
    if (!e2eConfig) {
      return;
    }

    const navigationKey = `${selectedFeedId ?? ''}:${selectedTag ?? ''}:${navigationNonce}`;
    if (navigationKeyRef.current === navigationKey) {
      return;
    }
    navigationKeyRef.current = navigationKey;

    void writeE2eEvent('navigation-changed', {
      sourceType: selectedFeedId ? 'feed' : selectedTag ? 'tag' : 'none',
      sourceId: selectedFeedId ?? selectedTag,
      selectedFeedId,
      selectedTag,
      navigationNonce,
    });
  }, [e2eConfig, navigationNonce, selectedFeedId, selectedTag]);

  useEffect(() => {
    if (!e2eConfig || deckPhaseRef.current === articleViewOverlayPhase) {
      return;
    }
    deckPhaseRef.current = articleViewOverlayPhase;
    void writeE2eEvent('article-deck-phase', {
      phase: articleViewOverlayPhase,
      activeArticleHash,
    });
  }, [activeArticleHash, articleViewOverlayPhase, e2eConfig]);
};
