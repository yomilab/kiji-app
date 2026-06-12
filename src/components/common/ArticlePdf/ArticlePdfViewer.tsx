import { useEffect, useRef } from 'react';
import type { ArticlePdfElementInstance } from './ArticlePdfElement';
import './ArticlePdfElement';

interface ArticlePdfViewerProps {
  url: string;
  suspendProcessing?: boolean;
  onOpenInBrowser: (withPressedFeedback?: boolean) => void;
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
}: ArticlePdfViewerProps) {
  const elementRef = useRef<ArticlePdfElementInstance>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    if (suspendProcessing) {
      element.cancelPendingWork?.();
      return;
    }

    element.setSource?.(url);
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
