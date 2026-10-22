import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { DEFAULT_SETTINGS } from '@/services/settings/types';
import { resolveActiveReaderTheme, resolveThemedReadingLayout } from '@/services/settings/readerThemes';
import {
  buildReaderTextSizePatch,
  effectiveReaderFontSize,
  nextReaderFontSize,
  readerTextSizePercent,
  type ReaderTextSizeAction,
} from '@/services/settings/readerTextSize';
import {
  getReaderTextSizeShortcutAction,
  getShortcutPriorityLayer,
  keybindingService,
} from '@/services/shortcuts/shortcutService';
import { captureReadingAnchor, restoreReadingAnchor } from '@/components/common/ArticleContent/readingAnchor';
import { getRendererWindowType } from '@/utils/rendererWindow';
import './ReaderTextSizeControl.css';

export const READER_TEXT_SIZE_INDICATOR_MS = 900;
/** Fast repeats write settings once, after the last step. */
export const READER_TEXT_SIZE_PERSIST_DELAY_MS = 250;
/** A menu command right after a handled key is the same press; ignore it. */
const MENU_ECHO_WINDOW_MS = 250;

interface ArticleContentHost extends HTMLElement {
  findReadingAnchor?: (top: number) => Element | null;
}

export const ReaderTextSizeIndicator: React.FC<{ percent: number; visible: boolean }> = ({ percent, visible }) => (
  <div
    className={`reader-text-size-indicator${visible ? ' is-visible' : ''}`}
    role="status"
    aria-live="polite"
    data-component="reader-text-size-indicator"
  >
    {`${percent}%`}
  </div>
);

interface ReaderTextSizeControlProps {
  scrollContainerRef: React.RefObject<HTMLElement | null>;
}

/**
 * ⌘+ / ⌘− / ⌘0 article text size. Lives beside the article (not inside it) so a
 * step only re-renders this component: the size is a CSS variable, the article
 * HTML is never set again, and the block at the top of the viewport stays put.
 * The step is saved as the Settings → Reading font size.
 */
export const ReaderTextSizeControl: React.FC<ReaderTextSizeControlProps> = ({ scrollContainerRef }) => {
  const { readingLayout, updateReadingLayout, readerAccent } = useTheme();
  const defaultLayout = DEFAULT_SETTINGS.readingLayout;
  const [indicator, setIndicator] = useState<{ percent: number; visible: boolean }>({ percent: 100, visible: false });

  const currentSizeRef = useRef(effectiveReaderFontSize(readingLayout, defaultLayout));
  const pendingSizeRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const lastKeyStepAtRef = useRef(0);
  const latestRef = useRef({ readingLayout, updateReadingLayout, readerAccent });
  latestRef.current = { readingLayout, updateReadingLayout, readerAccent };

  // Follow the saved size (Settings slider, other windows) unless a step is still being saved.
  useEffect(() => {
    if (pendingSizeRef.current !== null) return;
    currentSizeRef.current = effectiveReaderFontSize(readingLayout, defaultLayout);
  }, [readingLayout, defaultLayout]);

  const persist = useCallback(() => {
    persistTimerRef.current = null;
    const fontSize = pendingSizeRef.current;
    if (fontSize === null) return;
    const { readingLayout: layout, updateReadingLayout: update, readerAccent: accent } = latestRef.current;
    // With custom layout off, the screen shows the defaults or the reader theme's spacing.
    const readerTheme = accent ? resolveActiveReaderTheme(accent.themeId) : undefined;
    const onScreenLayout = readerTheme
      ? resolveThemedReadingLayout(layout, readerTheme, defaultLayout)
      : defaultLayout;
    const patch = buildReaderTextSizePatch(layout, fontSize, onScreenLayout);
    void update(patch)
      .then(() => window.kijiAPI?.notifySettingsChanged?.())
      .catch((error: unknown) => console.error('Error saving article text size:', error))
      .finally(() => {
        if (pendingSizeRef.current === fontSize) pendingSizeRef.current = null;
      });
  }, [defaultLayout]);

  const applyStep = useCallback((action: ReaderTextSizeAction) => {
    const current = currentSizeRef.current;
    const next = nextReaderFontSize(current, action, defaultLayout.fontSize);

    if (next !== current) {
      const scrollElement = scrollContainerRef.current;
      const host = scrollElement?.querySelector<ArticleContentHost>('article-content') ?? null;
      const anchor = scrollElement && host?.findReadingAnchor
        ? captureReadingAnchor(scrollElement, (top) => host.findReadingAnchor?.(top) ?? null)
        : null;
      // Same variable the saved setting writes, so the change is live before the save lands.
      document.documentElement.style.setProperty('--article-content-font-size', `${next}px`);
      if (scrollElement) restoreReadingAnchor(scrollElement, anchor);

      currentSizeRef.current = next;
      pendingSizeRef.current = next;
      if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = window.setTimeout(persist, READER_TEXT_SIZE_PERSIST_DELAY_MS);
    }

    setIndicator({ percent: readerTextSizePercent(next, defaultLayout.fontSize), visible: true });
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setIndicator((state) => ({ ...state, visible: false }));
    }, READER_TEXT_SIZE_INDICATOR_MS);
  }, [defaultLayout.fontSize, persist, scrollContainerRef]);

  useEffect(() => keybindingService.register({
    type: 'keydown',
    capture: true,
    priority: 210,
    handler: (event: KeyboardEvent) => {
      const action = getReaderTextSizeShortcutAction(event);
      if (!action) return;
      // Also keeps the native View menu item and webview zoom from acting on the same press.
      event.preventDefault();
      event.stopImmediatePropagation();
      lastKeyStepAtRef.current = Date.now();
      applyStep(action);
    },
  }), [applyStep]);

  useEffect(() => {
    if (!window.kijiAPI?.onAppMenuCommand) return undefined;
    const windowType = getRendererWindowType();
    return window.kijiAPI.onAppMenuCommand((command) => {
      if (command.type !== 'readerTextSize') return;
      if (command.window && command.window !== windowType) return;
      if (getShortcutPriorityLayer() !== 'article') return;
      if (Date.now() - lastKeyStepAtRef.current < MENU_ECHO_WINDOW_MS) return;
      applyStep(command.action);
    });
  }, [applyStep]);

  // Save a pending step and drop timers when the article closes.
  useEffect(() => () => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persist();
    }
  }, [persist]);

  return <ReaderTextSizeIndicator percent={indicator.percent} visible={indicator.visible} />;
};
