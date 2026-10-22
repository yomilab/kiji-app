import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ShortcutsPane } from '@/components/SettingsWindow/panes/ShortcutsPane';

describe('ShortcutsPane reading keys', () => {
  afterEach(() => {
    cleanup();
  });

  it('lists m and Space / Shift+Space', () => {
    render(<ShortcutsPane />);
    const keysFor = (label: string) =>
      Array.from(screen.getByText(label).closest('.shortcut-item')!.querySelectorAll('kbd')).map((kbd) => kbd.textContent);

    expect(keysFor('Mark as Read/Unread')).toEqual(['M']);
    expect(keysFor('Next Page, Then Next Unread')).toEqual(['Space']);
    expect(keysFor('Previous Page').at(-1)).toBe('Space');
  });
});
