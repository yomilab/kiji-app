import { describe, expect, it } from 'vitest';
import { toNativeArticleSortField } from '@/stores/articleStore';

describe('toNativeArticleSortField', () => {
  it('maps lastReadAt to last_read_at so Read queries cannot fall back to published_date', () => {
    expect(toNativeArticleSortField('lastReadAt')).toBe('last_read_at');
  });

  it('keeps published and fetched mappings for Unread, All, and feed lists', () => {
    expect(toNativeArticleSortField('publishedDate')).toBe('published_date');
    expect(toNativeArticleSortField('fetchedDate')).toBe('fetched_date');
    expect(toNativeArticleSortField(undefined)).toBeUndefined();
  });
});
