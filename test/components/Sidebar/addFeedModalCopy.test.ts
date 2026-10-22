import { describe, it, expect } from 'vitest';
import { FeedNotFoundError } from '@/services/feeds/feedAutodiscovery';
import {
  describeFileImportError,
  describeLinkError,
  formatExistingSubscriptionMessage,
  normalizeLinkInput,
} from '@/components/Sidebar/addFeedModalCopy';

describe('normalizeLinkInput', () => {
  it('keeps http and https links', () => {
    expect(normalizeLinkInput(' https://example.com/feed ')).toBe('https://example.com/feed');
    expect(normalizeLinkInput('http://example.com/rss')).toBe('http://example.com/rss');
  });

  it('adds https:// to a bare address', () => {
    expect(normalizeLinkInput('example.com/feed')).toBe('https://example.com/feed');
  });

  it('rejects text that is not a web link', () => {
    expect(normalizeLinkInput('')).toBeNull();
    expect(normalizeLinkInput('hello world')).toBeNull();
    expect(normalizeLinkInput('notalink')).toBeNull();
    expect(normalizeLinkInput('ftp://example.com/feed')).toBeNull();
    expect(normalizeLinkInput('javascript:alert(1)')).toBeNull();
  });
});

describe('user-facing copy', () => {
  it('never passes raw error text through', () => {
    const raw = 'invoke error: FEED_NETWORK reqwest::Error { kind: Connect }';
    expect(describeLinkError(new Error(raw))).not.toContain('reqwest');
    expect(describeFileImportError(new Error(raw))).not.toContain('reqwest');
  });

  it('says plainly when a page has no feed', () => {
    expect(describeLinkError(new FeedNotFoundError())).toBe('We couldn\'t find a feed on this page.');
  });

  it('names stations for an existing subscription', () => {
    expect(formatExistingSubscriptionMessage([])).toBe('You already follow this feed.');
    expect(formatExistingSubscriptionMessage(['Tech', 'News'])).toBe('You already follow this feed in Tech, News.');
  });
});
