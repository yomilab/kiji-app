import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { SidebarWidgets } from '@/components/Sidebar/SidebarWidgets';

vi.mock('@/contexts/FeedContext', () => ({
  useFeedCollectionActions: () => ({ refreshFeed: vi.fn() }),
  useFeedNavigation: () => ({
    selectedFeedId: 'feed-1',
    selectedTag: null,
    selectedSmartView: null,
  }),
}));

vi.mock('@/hooks/useFeedRefreshActivity', () => ({
  useFeedRefreshActivity: () => ({
    isAnyFeedRefreshing: true,
    interactiveRefreshScopeTotal: 0,
    interactiveRefreshCompleted: 0,
  }),
}));

vi.mock('@/components/Sidebar/UpdatePromptButton', () => ({
  UpdatePromptButton: () => null,
}));

describe('SidebarWidgets refresh spin', () => {
  afterEach(() => {
    cleanup();
  });

  it('spins a square icon wrapper, not a mismatched em box', () => {
    const { container } = render(
      <div className="sidebar-widgets-container">
        <SidebarWidgets onAddFeed={vi.fn()} />
      </div>,
    );

    const refresh = container.querySelector('[data-widget="refresh"]');
    const icon = refresh?.querySelector('.icon');
    expect(icon).not.toBeNull();
    expect(icon?.classList.contains('is-spinning')).toBe(true);
    expect(refresh?.querySelector('svg')).not.toBeNull();
  });
});
