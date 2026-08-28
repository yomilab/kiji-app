import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BottomWidget } from '@/components/Sidebar/BottomWidget';
import { SyncIndicator } from '@/components/Sidebar/SyncIndicator';

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'auto',
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
    fontFamilies: {
      uiFont: 'System',
      articleTitleFont: 'System',
      articleContentFont: 'System',
      articleNonAsciiFont: 'System',
    },
    updateFontFamilies: vi.fn(),
    readingLayout: {},
    updateReadingLayout: vi.fn(),
  }),
}));

vi.mock('@/contexts/FeedContext', () => ({
  useFeedNavigation: () => ({
    openFeedEditView: vi.fn(),
  }),
}));

describe('BottomWidget', () => {
  afterEach(() => {
    cleanup();
  });

  it('hosts SyncIndicator on the settings row without a Feeds title', () => {
    render(
      <BottomWidget>
        <SyncIndicator text="Refreshing 3/12 feeds" />
      </BottomWidget>,
    );

    const indicator = screen.getByText('Refreshing 3/12 feeds');
    expect(indicator.getAttribute('data-component')).toBe('sync-indicator');
    expect(screen.queryByRole('heading', { name: 'Feeds' })).toBeNull();
    expect(screen.getByLabelText(/settings/i)).toBeTruthy();
  });

  it('keeps the indicator before the settings stack so left-push can squeeze it', () => {
    const { container } = render(
      <BottomWidget>
        <SyncIndicator text="Today 16:52" />
      </BottomWidget>,
    );

    const toolbar = container.querySelector('.bottom-widget-toolbar');
    expect(toolbar).not.toBeNull();
    const stack = toolbar?.querySelector('.button-stack');
    const indicator = toolbar?.querySelector('[data-component="sync-indicator"]');
    expect(stack).not.toBeNull();
    expect(indicator).not.toBeNull();
    expect(stack?.getAttribute('data-direction')).toBe('left');
    expect(indicator?.compareDocumentPosition(stack as Node) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it('expands the settings stack on hover so push width can cover or clip the indicator', () => {
    const { container } = render(
      <BottomWidget>
        <SyncIndicator text="Refreshing 12/50 feeds" />
      </BottomWidget>,
    );

    const stack = container.querySelector('.button-stack');
    expect(stack).not.toBeNull();
    expect(stack?.getAttribute('data-expanded')).toBe('false');
    expect(stack?.getAttribute('data-direction')).toBe('left');

    fireEvent.mouseEnter(stack as HTMLElement);
    expect(stack?.getAttribute('data-expanded')).toBe('true');
    expect(stack?.getAttribute('data-layout-mode')).toBe('push');
  });

  it('pins the left-push cover to the trailing edge so Settings does not jump right', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/components/Sidebar/BottomWidget.css'),
      'utf8',
    );
    expect(css).toMatch(/bottom-widget-button-stack[\s\S]*left:\s*auto/);
    expect(css).toMatch(/bottom-widget-button-stack[\s\S]*right:\s*0/);
  });
});
