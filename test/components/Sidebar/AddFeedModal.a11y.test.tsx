import { describe, it, expect, afterEach, vi } from 'vitest';
import { findSeriousAxeViolations } from '../../helpers/axe';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AddFeedModal } from '@/components/Sidebar/AddFeedModal';
import { feedsManager } from '@/services/feeds/feedsManager';
import { feedsFetcher, parseFeed } from '@/services/feeds/feedsFetcher';
import { storeParsedFeedContent } from '@/services/feeds/feedRefreshPipeline';
import { faviconFetcher } from '@/services/favicons/faviconFetcher';
import * as articleStore from '@/stores/articleStore';
import { logger } from '@/services/logger';
import {
  fetchOpmlTextFromUrl,
  importOpmlTextIntoLibrary,
  navigateAfterOpmlImport,
  openOpmlFileForImport,
} from '@/services/feeds/opmlUiWorkflow';
import { savedArticlesIOService } from '@/services/saved/savedArticlesIOService';
import { appToastService } from '@/services/ui/appToastService';

vi.mock('@/contexts/FeedContext', () => ({
  useFeedUIActions: () => ({
    refreshTotalFeeds: vi.fn(),
    notifyFeedLibraryChanged: vi.fn(),
  }),
  useFeedNavigation: () => ({
    selectFeed: vi.fn(),
    selectTag: vi.fn(),
  }),
}));

vi.mock('@/services/feeds/feedsManager', () => ({
  feedsManager: {
    getFeedByUrl: vi.fn(),
    generateId: vi.fn(() => 'feed-new'),
    addFeed: vi.fn(),
    updateFeed: vi.fn(),
  },
}));

vi.mock('@/services/feeds/feedsFetcher', () => ({
  feedsFetcher: {
    fetchFeedNetworkWithCache: vi.fn(),
  },
  parseFeed: vi.fn(),
}));

vi.mock('@/services/feeds/feedRefreshPipeline', () => ({
  storeParsedFeedContent: vi.fn(),
}));

vi.mock('@/services/feeds/opmlUiWorkflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/feeds/opmlUiWorkflow')>();
  return {
    ...actual,
    fetchOpmlTextFromUrl: vi.fn(),
    importOpmlTextIntoLibrary: vi.fn(),
    navigateAfterOpmlImport: vi.fn(),
    openOpmlFileForImport: vi.fn(),
  };
});

vi.mock('@/services/saved/savedArticlesIOService', () => ({
  savedArticlesIOService: {
    importSavedArticles: vi.fn(),
  },
}));

vi.mock('@/services/ui/appToastService', () => ({
  appToastService: { show: vi.fn() },
}));

vi.mock('@/services/favicons/faviconFetcher', () => ({
  faviconFetcher: {
    fetchFavicon: vi.fn(),
  },
}));

vi.mock('@/stores/articleStore', () => ({
  syncFeedCountsBatch: vi.fn(),
}));

vi.mock('@/services/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

afterEach(cleanup);

describe('AddFeedModal accessibility', () => {
  it('has no serious axe violations on either tab', async () => {
    render(<AddFeedModal isOpen onClose={vi.fn()} onFeedAdded={vi.fn()} />);
    await screen.findByLabelText('Feed or website link');
    expect(await findSeriousAxeViolations(document.body)).toEqual([]);

    const tabs = screen.getAllByRole('tab');
    fireEvent.click(tabs[tabs.length - 1]);
    await waitFor(() => expect(tabs[tabs.length - 1].getAttribute('aria-selected')).toBe('true'));
    expect(await findSeriousAxeViolations(document.body)).toEqual([]);
  });

  it('is a labelled modal dialog with a named close button', async () => {
    render(<AddFeedModal isOpen onClose={vi.fn()} onFeedAdded={vi.fn()} />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Add Feeds' })).toBe(dialog);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('keeps Tab inside the dialog and gives focus back to the opener on close', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(<AddFeedModal isOpen onClose={vi.fn()} onFeedAdded={vi.fn()} />);
    const dialog = await screen.findByRole('dialog');

    const close = screen.getByRole('button', { name: 'Close' });
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(close);

    rerender(<AddFeedModal isOpen={false} onClose={vi.fn()} onFeedAdded={vi.fn()} />);
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });
});
