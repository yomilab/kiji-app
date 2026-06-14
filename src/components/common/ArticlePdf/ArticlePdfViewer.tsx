import { useEffect, useRef } from 'react';
import type { ArticlePdfElementInstance } from './ArticlePdfElement';
import './ArticlePdfElement';

interface ArticlePdfViewerProps {
  url: string;
  suspendProcessing?: boolean;
  onOpenInBrowser: (withPressedFeedback?: boolean) => void;
  onLoadStart?: () => void;
  onFirstPageRendered?: () => void;
  onLoadError?: () => void;
}

/**
 * React wrapper for ArticlePdfElement.
 * PDF bytes, pdf.js documents, and canvas buffers are owned by the custom element
 * and released on cancelPendingWork / disconnect (article close or article switch).
 */
export function ArticlePdfViewer({
  url,
  suspendProcessing = false,
  onOpenInBrowser,
  onLoadStart,
  onFirstPageRendered,
  onLoadError,
}: ArticlePdfViewerProps) {
  const elementRef = useRef<ArticlePdfElementInstance>(null);
  const onLoadStartRef = useRef(onLoadStart);
  const onFirstPageRenderedRef = useRef(onFirstPageRendered);
  const onLoadErrorRef = useRef(onLoadError);

  onLoadStartRef.current = onLoadStart;
  onFirstPageRenderedRef.current = onFirstPageRendered;
  onLoadErrorRef.current = onLoadError;

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    const handleLoadStart = () => onLoadStartRef.current?.();
    const handleFirstPageRendered = () => onFirstPageRenderedRef.current?.();
    const handleLoadError = () => onLoadErrorRef.current?.();

    element.addEventListener('article-pdf-load-start', handleLoadStart);
    element.addEventListener('article-pdf-first-page-rendered', handleFirstPageRendered);
    element.addEventListener('article-pdf-load-error', handleLoadError);

    return () => {
      element.removeEventListener('article-pdf-load-start', handleLoadStart);
      element.removeEventListener('article-pdf-first-page-rendered', handleFirstPageRendered);
      element.removeEventListener('article-pdf-load-error', handleLoadError);
    };
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    if (suspendProcessing) {
      element.cancelPendingWork?.({ silent: true });
    } else {
      element.setSource?.(url);
    }

    return () => {
      element.cancelPendingWork?.({ silent: true });
    };
  }, [url, suspendProcessing]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    const handleOpenExternal = () => {
      onOpenInBrowser(true);
    };

    element.addEventListener('article-pdf-open-external', handleOpenExternal);
    return () => {
      element.removeEventListener('article-pdf-open-external', handleOpenExternal);
    };
  }, [onOpenInBrowser]);

  return <article-pdf ref={elementRef} />;
}
