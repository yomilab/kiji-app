import { useEffect, useRef } from 'react';
import type { Article } from '@/types/article';
import type { ReaderModeContent } from '@/services/articles/readerModeService';
import type { ArticleViewOverlayPhase } from '@/contexts/FeedContext';
import { getE2eConfig, writeE2eEvent } from '@/services/e2e/e2eHarness';

interface UseE2eArticleViewProbesOptions {
  standalone: boolean;
  articleToShow: Article | null;
  articleViewOverlayPhase: ArticleViewOverlayPhase;
  articleDisplayMode: string;
  readerContent: ReaderModeContent | null;
  articleResourceType: 'html' | 'pdf' | 'unsupported' | null;
  onToggleReaderMode: (nextStateIndex: number) => void;
}

export const useE2eArticleViewProbes = ({
  standalone,
  articleToShow,
  articleViewOverlayPhase,
  articleDisplayMode,
  readerContent,
  articleResourceType,
  onToggleReaderMode,
}: UseE2eArticleViewProbesOptions): { onPdfFirstPageRendered: () => void } => {
  const contentReadyHashRef = useRef<string | null>(null);
  const readerModeRef = useRef<string | null>(null);
  const readerReadyHashRef = useRef<string | null>(null);
  const pdfReadyLinkRef = useRef<string | null>(null);

  useEffect(() => {
    if (standalone || !getE2eConfig()) {
      return;
    }

    const handleToggle = () => {
      onToggleReaderMode(1);
    };

    window.addEventListener('kiji-e2e:toggle-reader-mode', handleToggle);
    return () => {
      window.removeEventListener('kiji-e2e:toggle-reader-mode', handleToggle);
    };
  }, [onToggleReaderMode, standalone]);

  useEffect(() => {
    if (standalone || !getE2eConfig() || !articleToShow) {
      return;
    }
    if (articleViewOverlayPhase !== 'open') {
      return;
    }
    if (contentReadyHashRef.current === articleToShow.hash) {
      return;
    }
    contentReadyHashRef.current = articleToShow.hash;
    void writeE2eEvent('article-content-ready', {
      title: articleToShow.title,
      hash: articleToShow.hash,
      hasBody: Boolean(articleToShow.content || articleToShow.summary),
      resourceType: articleResourceType ?? 'html',
      link: articleToShow.link,
    });
  }, [articleResourceType, articleToShow, articleViewOverlayPhase, standalone]);

  useEffect(() => {
    if (standalone || !getE2eConfig()) {
      return;
    }
    if (readerModeRef.current === articleDisplayMode) {
      return;
    }
    readerModeRef.current = articleDisplayMode;
    void writeE2eEvent('reader-mode-changed', {
      mode: articleDisplayMode === 'reader' ? 'reader' : 'basic',
    });
  }, [articleDisplayMode, standalone]);

  useEffect(() => {
    if (standalone || !getE2eConfig() || !articleToShow || articleDisplayMode !== 'reader') {
      return;
    }
    if (!readerContent || readerReadyHashRef.current === articleToShow.hash) {
      return;
    }
    readerReadyHashRef.current = articleToShow.hash;
    void writeE2eEvent('reader-content-ready', {
      hash: articleToShow.hash,
      wordCount: readerContent.textContent?.split(/\s+/).filter(Boolean).length ?? 0,
      contentLength: readerContent.content?.length ?? 0,
    });
  }, [articleDisplayMode, articleToShow, readerContent, standalone]);

  useEffect(() => {
    if (standalone || !getE2eConfig() || !articleToShow) {
      return;
    }
    if (articleResourceType !== 'pdf') {
      return;
    }
    void writeE2eEvent('pdf-detected', {
      link: articleToShow.link,
      hash: articleToShow.hash,
    });
  }, [articleResourceType, articleToShow, standalone]);

  const onPdfFirstPageRendered = () => {
    if (standalone || !getE2eConfig() || !articleToShow?.link) {
      return;
    }
    if (pdfReadyLinkRef.current === articleToShow.link) {
      return;
    }
    pdfReadyLinkRef.current = articleToShow.link;
    void writeE2eEvent('pdf-render-ready', {
      link: articleToShow.link,
      pageCount: 1,
    });
  };

  return { onPdfFirstPageRendered };
};
