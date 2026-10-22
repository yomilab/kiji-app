import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FiltersPane, type MuteRulesService } from '@/components/ManageFeedsWindow/FiltersPane';
import {
  formatMutePreview,
  scopeFromValue,
  scopeToValue,
  validateMuteDraft,
} from '@/components/ManageFeedsWindow/muteRulesModel';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import type { MuteRule } from '@/types/muteRules';

vi.mock('@/services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const feeds = [
  { id: 'feed-a', title: 'Alpha News' },
  { id: 'feed-b', title: 'Beta Blog' },
];
const stations = [{ name: 'Tech' }];

const rule = (overrides: Partial<MuteRule> = {}): MuteRule => ({
  id: 'r1',
  text: 'crypto',
  matchDescription: false,
  scope: { kind: 'all' },
  action: 'mark-read',
  ...overrides,
});

const createService = (initial: MuteRule[] = []) => {
  let stored = initial;
  const service = {
    get: vi.fn(async () => stored),
    set: vi.fn(async (next: MuteRule[]) => {
      stored = next;
      return next;
    }),
    preview: vi.fn(async () => ({ matched: 3, scanned: 500 })),
    applyToExisting: vi.fn(async () => ({
      markedCount: 4,
      feeds: [{ feedId: 'feed-a', unreadCount: 2, articleCount: 10 }],
    })),
  } satisfies MuteRulesService;
  return service;
};

const renderPane = (service: MuteRulesService) => render(
  <FiltersPane feeds={feeds} stations={stations} service={service} />,
);

describe('FiltersPane', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows an empty state, then adds a rule scoped to a feed', async () => {
    const service = createService();
    renderPane(service);
    expect(await screen.findByText('No mute words')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /New Mute Word/ })[0]);
    const dialog = screen.getByRole('dialog', { name: 'New Mute Word' });
    fireEvent.change(within(dialog).getByLabelText('Word or phrase'), { target: { value: '  Giveaway  ' } });
    fireEvent.click(within(dialog).getByLabelText('Also check the summary'));
    fireEvent.change(within(dialog).getByLabelText('Apply to'), { target: { value: 'feed:feed-b' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(service.set).toHaveBeenCalledTimes(1));
    const saved = service.set.mock.calls[0][0];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      text: 'Giveaway',
      matchDescription: true,
      scope: { kind: 'feed', id: 'feed-b' },
      action: 'mark-read',
    });
    const list = await screen.findByRole('list', { name: 'Mute words' });
    expect(within(list).getByText('“Giveaway”')).toBeInTheDocument();
    expect(within(list).getByText('Beta Blog')).toBeInTheDocument();
    expect(within(list).getByText('Title and summary · Mark as read')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('edits and deletes an existing rule', async () => {
    const service = createService([rule(), rule({ id: 'r2', text: 'sports', scope: { kind: 'station', name: 'Tech' } })]);
    renderPane(service);
    const list = await screen.findByRole('list', { name: 'Mute words' });
    expect(within(list).getByText('Station: Tech')).toBeInTheDocument();

    fireEvent.click(within(list).getByRole('button', { name: 'Edit crypto' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Mute Word' });
    const input = within(dialog).getByLabelText('Word or phrase');
    expect(input).toHaveValue('crypto');
    fireEvent.change(input, { target: { value: 'bitcoin' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(service.set).toHaveBeenCalledTimes(1));
    expect(service.set.mock.calls[0][0].map((entry) => [entry.id, entry.text])).toEqual([['r1', 'bitcoin'], ['r2', 'sports']]);
    expect(await within(list).findByText('“bitcoin”')).toBeInTheDocument();

    fireEvent.click(within(list).getByRole('button', { name: 'Delete sports' }));
    await waitFor(() => expect(service.set).toHaveBeenCalledTimes(2));
    expect(service.set.mock.calls[1][0].map((entry) => entry.id)).toEqual(['r1']);
    await waitFor(() => expect(within(list).queryByText('“sports”')).toBeNull());
  });

  it('blocks empty and duplicate rules in plain language', async () => {
    const service = createService([rule()]);
    renderPane(service);
    await screen.findByRole('list', { name: 'Mute words' });
    fireEvent.click(screen.getByRole('button', { name: /New Mute Word/ }));
    const dialog = screen.getByRole('dialog', { name: 'New Mute Word' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(within(dialog).getByText('Enter a word or phrase.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Word or phrase'), { target: { value: 'CRYPTO' } });
    expect(within(dialog).getByText('This word already has a rule for the same feeds.')).toBeInTheDocument();
    expect(service.set).not.toHaveBeenCalled();
  });

  it('shows a live match hint from the recent articles after typing pauses', async () => {
    vi.useFakeTimers();
    const service = createService();
    renderPane(service);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getAllByRole('button', { name: /New Mute Word/ })[0]);
    const dialog = screen.getByRole('dialog', { name: 'New Mute Word' });
    fireEvent.change(within(dialog).getByLabelText('Word or phrase'), { target: { value: 'cr' } });
    fireEvent.change(within(dialog).getByLabelText('Word or phrase'), { target: { value: 'crypto' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(service.preview).toHaveBeenCalledTimes(1);
    expect(service.preview.mock.calls[0][0]).toMatchObject({ text: 'crypto', scope: { kind: 'all' } });
    expect(within(dialog).getByText('Would match 3 of the last 500 articles.')).toBeInTheDocument();
  });

  it('applies rules to unread articles once and relays the new counts', async () => {
    const publish = vi.spyOn(feedLibraryMutationBus, 'publishFeedsCountsUpdated');
    const service = createService([rule()]);
    renderPane(service);
    await screen.findByRole('list', { name: 'Mute words' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply to Unread Articles…' }));
    const dialog = screen.getByRole('dialog', { name: 'Mark matching unread articles as read?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark as Read' }));
    await waitFor(() => expect(service.applyToExisting).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Marked 4 articles as read.')).toBeInTheDocument();
    expect(publish).toHaveBeenCalledWith([{ feedId: 'feed-a', unreadCount: 2, articleCount: 10 }]);
  });
});

describe('muteRulesModel', () => {
  it('round-trips scope select values', () => {
    for (const scope of [{ kind: 'all' }, { kind: 'feed', id: 'x:y' }, { kind: 'station', name: 'News' }] as const) {
      expect(scopeFromValue(scopeToValue(scope))).toEqual(scope);
    }
  });

  it('allows the same word for a different scope and caps the rule count', () => {
    expect(validateMuteDraft('crypto', { kind: 'feed', id: 'feed-a' }, [rule()], null)).toBeNull();
    const many = Array.from({ length: 200 }, (_, index) => rule({ id: `r${index}`, text: `w${index}` }));
    expect(validateMuteDraft('new', { kind: 'all' }, many, null)).toBe('You can have up to 200 mute words.');
    expect(validateMuteDraft('new', { kind: 'all' }, many, 'r1')).toBeNull();
  });

  it('describes small libraries without claiming 500 articles', () => {
    expect(formatMutePreview({ matched: 1, scanned: 40 })).toBe('Would match 1 of your 40 articles.');
    expect(formatMutePreview({ matched: 0, scanned: 500 })).toBe('Wouldn’t match any of the last 500 articles.');
  });
});
