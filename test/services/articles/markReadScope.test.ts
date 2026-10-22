import { describe, expect, it } from 'vitest';
import {
  applyRowReadPatch,
  canMarkSourceRead,
  markReadCutoff,
  markReadToastText,
  toMarkReadScope,
} from '@/services/articles/markReadScope';
import type { Article } from '@/types/article';

const row = (hash: string, read: boolean, publishedDate: string): Article => ({
  hash,
  title: hash,
  description: '',
  content: '',
  fetchedDate: publishedDate,
  publishedDate,
  feedId: 'f1',
  feedUrl: '',
  read,
  starred: false,
  saved: false,
});

describe('markReadScope', () => {
  it('maps the list on screen to a native scope; Saved and Read have none', () => {
    expect(toMarkReadScope({ type: 'feed', feedId: 'f1' })).toEqual({ feedId: 'f1' });
    expect(toMarkReadScope({ type: 'tag', tagName: 'Tech' })).toEqual({ tagName: 'Tech' });
    expect(toMarkReadScope({ type: 'smart', viewType: 'all' })).toEqual({ smartView: 'all' });
    expect(toMarkReadScope({ type: 'smart', viewType: 'unread' })).toEqual({ smartView: 'unread' });
    expect(toMarkReadScope({ type: 'smart', viewType: 'today' })).toEqual({ smartView: 'today' });
    expect(toMarkReadScope({ type: 'smart', viewType: 'pinned' })).toEqual({ tagName: 'pinned' });
    expect(canMarkSourceRead({ type: 'smart', viewType: 'saved' })).toBe(false);
    expect(canMarkSourceRead({ type: 'smart', viewType: 'read' })).toBe(false);
    expect(canMarkSourceRead(null)).toBe(false);
  });

  it('computes day and week cutoffs', () => {
    const now = new Date('2026-10-22T12:00:00.000Z');
    expect(markReadCutoff(1, now)).toBe('2026-10-21T12:00:00.000Z');
    expect(markReadCutoff(7, now)).toBe('2026-10-15T12:00:00.000Z');
  });

  it('patches exact rows in place and keeps the array when nothing changes', () => {
    const rows = [row('a', false, '2026-10-20T00:00:00.000Z'), row('b', false, '2026-10-01T00:00:00.000Z')];
    const marked = applyRowReadPatch(rows, { read: true, hashes: new Set(['b']) });
    expect(marked.map((article) => [article.hash, article.read])).toEqual([['a', false], ['b', true]]);
    expect(marked[0]).toBe(rows[0]);
    expect(applyRowReadPatch(marked, { read: true, hashes: new Set(['b']) })).toBe(marked);

    const undone = applyRowReadPatch(marked, { read: false, hashes: new Set(['b']) });
    expect(undone.map((article) => article.read)).toEqual([false, false]);
  });

  it('falls back to the cutoff when the batch was too large to keep hashes', () => {
    const rows = [row('new', false, '2026-10-20T00:00:00.000Z'), row('old', false, '2026-10-01T00:00:00.000Z')];
    expect(applyRowReadPatch(rows, { read: true, hashes: null, olderThan: '2026-10-15T00:00:00.000Z' })
      .map((article) => article.read)).toEqual([false, true]);
    expect(applyRowReadPatch(rows, { read: true, hashes: null }).every((article) => article.read)).toBe(true);
  });

  it('writes plain toast copy', () => {
    expect(markReadToastText(1)).toBe('Marked 1 article as read');
    expect(markReadToastText(12, 7)).toBe('Marked 12 older articles as read');
    expect(markReadToastText(0)).toBe('No unread articles');
    expect(markReadToastText(0, 1)).toBe('No older unread articles');
  });
});
