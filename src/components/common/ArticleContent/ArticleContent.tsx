import { useRef, useEffect } from 'react';
import './ArticleContentElement';

interface ArticleContentProps {
  htmlContent: string;
  baseUrl?: string;
  onLinkClick?: (href: string) => void;
  onImageContextMenu?: (src: string) => void;
  mediaProcessingDelayMs?: number;
  suspendProcessing?: boolean;
}

interface ArticleContentElement extends HTMLElement {
  setContent?: (html: string, options?: { baseUrl?: string; deferMediaProcessingMs?: number; isPreprocessed?: boolean }) => void;
  cancelPendingWork?: () => void;
}

/**
 * React wrapper for ArticleContentElement Web Component
 *
 * Provides CSS isolation via Shadow DOM while integrating with React lifecycle.
 */
const ArticleContent = ({
  htmlContent,
  baseUrl,
  onLinkClick,
  onImageContextMenu,
  mediaProcessingDelayMs = 0,
  suspendProcessing = false,
}: ArticleContentProps) => {
  const elementRef = useRef<ArticleContentElement>(null);

  // Update content when htmlContent changes
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    if (suspendProcessing) {
      element.cancelPendingWork?.();
      return;
    }

    if (element.setContent) {
      element.setContent(htmlContent, {
        baseUrl,
        deferMediaProcessingMs: mediaProcessingDelayMs,
        isPreprocessed: true,
      });
    }
  }, [htmlContent, baseUrl, mediaProcessingDelayMs, suspendProcessing]);

  // Attach link click event listener
  useEffect(() => {
    const element = elementRef.current;
    if (!element || !onLinkClick) return;

    const handleLinkClick = (event: Event) => {
      const customEvent = event as CustomEvent<{ href: string }>;
      onLinkClick(customEvent.detail.href);
    };

    element.addEventListener('article-link-click', handleLinkClick);

    return () => {
      element.removeEventListener('article-link-click', handleLinkClick);
    };
  }, [onLinkClick]);

  // Attach broken-image context menu event listener
  useEffect(() => {
    const element = elementRef.current;
    if (!element || !onImageContextMenu) return;

    const handleImageContextMenu = (event: Event) => {
      const customEvent = event as CustomEvent<{ src: string }>;
      onImageContextMenu(customEvent.detail.src);
    };

    element.addEventListener('article-image-context-menu', handleImageContextMenu);

    return () => {
      element.removeEventListener('article-image-context-menu', handleImageContextMenu);
    };
  }, [onImageContextMenu]);

  // Keep article-content accent color in sync with root/system accent color updates.
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const syncAccentColor = () => {
      const rootStyles = window.getComputedStyle(document.documentElement);
      const accentColor = rootStyles.getPropertyValue('--system-accent-color').trim();
      if (!accentColor) return;
      element.style.setProperty('--article-content-accent-color', accentColor);
    };

    syncAccentColor();

    const observer = new MutationObserver(() => {
      syncAccentColor();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-theme'],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return <article-content ref={elementRef} />;
};

export default ArticleContent;
