import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { findSeriousAxeViolations } from '../../helpers/axe';
import { buildCommandPaletteEntries } from '@/components/CommandPalette/commandPaletteModel';

vi.mock('@/services/favicons/sidebarFaviconCache', () => ({
  needsSidebarFavicon: () => false,
  hydrateSidebarFavicons: async () => new Map(),
  applySidebarFavicons: (rows: unknown[]) => rows,
}));

import { CommandPalette } from '@/components/CommandPalette/CommandPalette';

const entries = buildCommandPaletteEntries(
  {
    feeds: [
      { id: 'feed-design', title: 'Design Systems Weekly', url: 'https://example.com/design.xml', tags: ['Design'] },
      { id: 'feed-world', title: 'World Briefing', url: 'https://example.com/world.xml', tags: [] },
    ],
    stations: [{ name: 'Design', feedIds: ['feed-design'], sortOrder: 0 }],
    smartViews: [{ id: 'unread', visible: true }],
  },
  [{ id: 'refresh', title: 'Refresh', shortcut: 'Cmd+R' }],
);

afterEach(cleanup);

describe('CommandPalette accessibility', () => {
  it('has no serious axe violations with results and with no matches', async () => {
    const { unmount } = render(
      <CommandPalette entries={entries} recentKeys={[]} onPick={vi.fn()} onClose={vi.fn()} initialQuery="" />,
    );
    expect(await findSeriousAxeViolations(document.body)).toEqual([]);
    unmount();

    render(<CommandPalette entries={entries} recentKeys={[]} onPick={vi.fn()} onClose={vi.fn()} initialQuery="zzzz" />);
    expect(await findSeriousAxeViolations(document.body)).toEqual([]);
  });

  it('is a labelled combobox whose active option follows the arrow keys', () => {
    render(<CommandPalette entries={entries} recentKeys={[]} onPick={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByRole('combobox', { name: 'Go to a feed, station, or action' });
    expect(document.activeElement).toBe(input);
    const listbox = screen.getByRole('listbox');
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);

    const firstId = input.getAttribute('aria-activedescendant');
    expect(document.getElementById(firstId!)?.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    const secondId = input.getAttribute('aria-activedescendant');
    expect(secondId).not.toBe(firstId);
    expect(document.getElementById(secondId!)?.getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById(firstId!)?.getAttribute('aria-selected')).toBe('false');
  });

  it('announces the number of results and the empty state', () => {
    render(<CommandPalette entries={entries} recentKeys={[]} onPick={vi.fn()} onClose={vi.fn()} initialQuery="design" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/^\d+ results?$/);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzz' } });
    expect(screen.getByRole('status').textContent).toBe('No matches');
  });
});
