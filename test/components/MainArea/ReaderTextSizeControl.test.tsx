import React, { Profiler, useRef } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type ReadingLayoutSettings } from '@/services/settings';
import type { AppMenuCommand } from '@/types/appMenu';

const theme = vi.hoisted(() => ({
  readingLayout: null as unknown as ReadingLayoutSettings,
  updateReadingLayout: vi.fn(async (_patch: Partial<ReadingLayoutSettings>) => {}),
}));

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    readingLayout: theme.readingLayout,
    updateReadingLayout: theme.updateReadingLayout,
    readerAccent: null,
  }),
}));

import {
  READER_TEXT_SIZE_INDICATOR_MS,
  READER_TEXT_SIZE_PERSIST_DELAY_MS,
  ReaderTextSizeControl,
} from '@/components/MainArea/ReaderTextSizeControl';

const ARTICLE_HTML = '<p>First paragraph</p><p>Second paragraph</p>';

/** Article body stand-in: counts renders and content writes, like ArticleContent's setContent. */
const setContent = vi.fn();
let contentRenders = 0;

const FakeArticleBody: React.FC = React.memo(() => {
  const ref = useRef<HTMLElement & { findReadingAnchor?: (top: number) => Element | null }>(null);
  React.useEffect(() => {
    const host = ref.current!;
    host.innerHTML = ARTICLE_HTML;
    setContent(ARTICLE_HTML);
    host.findReadingAnchor = () => host.lastElementChild;
  }, []);
  return <article-content ref={ref} />;
});

const Harness: React.FC = () => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  return (
    <div className="article-view-window">
      <div ref={scrollRef} data-testid="scroll">
        <Profiler id="article-body" onRender={() => { contentRenders += 1; }}>
          <FakeArticleBody />
        </Profiler>
      </div>
      <ReaderTextSizeControl scrollContainerRef={scrollRef} />
    </div>
  );
};

const press = (key: string, extra: Partial<KeyboardEventInit> = {}) => {
  const event = new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true, ...extra });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
};

const rootFontSize = () => document.documentElement.style.getPropertyValue('--article-content-font-size');

describe('ReaderTextSizeControl', () => {
  let menuListener: ((command: AppMenuCommand) => void) | null = null;
  const notifySettingsChanged = vi.fn(async () => {});

  beforeEach(() => {
    vi.useFakeTimers();
    theme.readingLayout = { ...DEFAULT_SETTINGS.readingLayout, enabled: true };
    theme.updateReadingLayout.mockClear();
    setContent.mockClear();
    contentRenders = 0;
    document.documentElement.style.removeProperty('--article-content-font-size');
    window.kijiAPI = {
      notifySettingsChanged,
      onAppMenuCommand: (callback: (command: AppMenuCommand) => void) => {
        menuListener = callback;
        return () => { menuListener = null; };
      },
    } as unknown as typeof window.kijiAPI;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete (window as { kijiAPI?: unknown }).kijiAPI;
  });

  it('steps the size live, shows the percentage, and saves it as the reading font size', async () => {
    render(<Harness />);
    const event = press('=');
    expect(event.defaultPrevented).toBe(true);
    press('+', { shiftKey: true });
    press('=');
    expect(rootFontSize()).toBe('23px');
    expect(screen.getByRole('status')).toHaveTextContent('130%');
    expect(screen.getByRole('status')).toHaveClass('is-visible');

    // Fast repeats are saved once, with the final size.
    expect(theme.updateReadingLayout).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(READER_TEXT_SIZE_PERSIST_DELAY_MS);
    });
    expect(theme.updateReadingLayout).toHaveBeenCalledTimes(1);
    expect(theme.updateReadingLayout).toHaveBeenCalledWith({ fontSize: 23 });
    expect(notifySettingsChanged).toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(READER_TEXT_SIZE_INDICATOR_MS);
    });
    expect(screen.getByRole('status')).not.toHaveClass('is-visible');
  });

  it('never re-renders or re-sets the article content', () => {
    render(<Harness />);
    expect(setContent).toHaveBeenCalledTimes(1);
    const rendersBefore = contentRenders;
    press('=');
    press('-');
    press('0');
    act(() => {
      vi.advanceTimersByTime(READER_TEXT_SIZE_INDICATOR_MS);
    });
    expect(setContent).toHaveBeenCalledTimes(1);
    expect(contentRenders).toBe(rendersBefore);
  });

  it('clamps at 200% and 80%', async () => {
    render(<Harness />);
    for (let index = 0; index < 20; index += 1) press('=');
    expect(rootFontSize()).toBe('36px');
    expect(screen.getByRole('status')).toHaveTextContent('200%');
    for (let index = 0; index < 30; index += 1) press('-');
    expect(rootFontSize()).toBe('14px');
    expect(screen.getByRole('status')).toHaveTextContent('80%');
    await act(async () => {
      vi.advanceTimersByTime(READER_TEXT_SIZE_PERSIST_DELAY_MS);
    });
    expect(theme.updateReadingLayout).toHaveBeenLastCalledWith({ fontSize: 14 });
  });

  it('Cmd+0 resets to the default size', async () => {
    theme.readingLayout = { ...DEFAULT_SETTINGS.readingLayout, enabled: true, fontSize: 29 };
    render(<Harness />);
    press('0');
    expect(rootFontSize()).toBe(`${DEFAULT_SETTINGS.readingLayout.fontSize}px`);
    expect(screen.getByRole('status')).toHaveTextContent('100%');
    await act(async () => {
      vi.advanceTimersByTime(READER_TEXT_SIZE_PERSIST_DELAY_MS);
    });
    expect(theme.updateReadingLayout).toHaveBeenCalledWith({ fontSize: DEFAULT_SETTINGS.readingLayout.fontSize });
  });

  it('turns custom layout on with the on-screen values when it was off', async () => {
    theme.readingLayout = { ...DEFAULT_SETTINGS.readingLayout, enabled: false, fontSize: 24, lineSpacing: 2.4 };
    render(<Harness />);
    press('=');
    // Starts from the size on screen (the default), not the stored-but-unused 24px.
    expect(rootFontSize()).toBe('20px');
    await act(async () => {
      vi.advanceTimersByTime(READER_TEXT_SIZE_PERSIST_DELAY_MS);
    });
    expect(theme.updateReadingLayout).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS.readingLayout,
      enabled: true,
      fontSize: 20,
    });
  });

  it('keeps the block at the top of the viewport in place', () => {
    render(<Harness />);
    const scroll = screen.getByTestId('scroll');
    const anchor = scroll.querySelector('article-content p:last-child')!;
    const size = () => parseFloat(rootFontSize()) || 18;
    scroll.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600 } as DOMRect);
    // The block starts at 500px * scale in content coordinates and is 100px * scale tall.
    anchor.getBoundingClientRect = () => {
      const scale = size() / 18;
      const top = 500 * scale - scroll.scrollTop;
      return { top, bottom: top + 100 * scale, height: 100 * scale, width: 100 } as DOMRect;
    };
    scroll.scrollTop = 550; // halfway into the block

    press('0', { metaKey: true }); // already default: no change
    expect(scroll.scrollTop).toBe(550);

    press('='); // 20px
    const scale = 20 / 18;
    expect(scroll.scrollTop).toBeCloseTo(500 * scale + 50 * scale, 0);
  });

  it('applies View menu commands for this window only and ignores the echo of a handled key', () => {
    render(<Harness />);
    act(() => {
      menuListener?.({ type: 'readerTextSize', action: 'bigger', window: 'settings' as never });
    });
    expect(rootFontSize()).toBe('');

    act(() => {
      menuListener?.({ type: 'readerTextSize', action: 'bigger', window: 'main' });
    });
    expect(rootFontSize()).toBe('20px');

    press('=');
    act(() => {
      menuListener?.({ type: 'readerTextSize', action: 'bigger', window: 'main' });
    });
    expect(rootFontSize()).toBe('22px');
  });
});
