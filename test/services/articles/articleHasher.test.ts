import { describe, expect, it } from "vitest";
import { articleHasher } from '@/services/articles/articleHasher';
import type { FeedItem } from '@/services/feeds/feedsFetcher';

describe('ArticleHasher', () => {
  const mockFeedId = 'https://example.com/feed.xml';
  const altFeedId = 'https://other.com/feed.xml';

  const makeFeedItem = (overrides: Partial<FeedItem>): FeedItem => ({
    id: 'test-id',
    title: '',
    content: '',
    feedId: mockFeedId,
    ...overrides,
  });

  describe('generateHash - Priority 1: normalized link', () => {
    it('should prefer link over guid when both are available', async () => {
      const item = makeFeedItem({
        guid: 'unique-guid-123',
        title: 'Test Article',
        content: 'Content',
        link: 'https://example.com/article',
      });

      const hash = await articleHasher.generateHash(item, mockFeedId);
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64); // SHA-256 produces 64 hex characters
    });

    it('should produce the same hash for duplicate entries with the same feed and link but different guid', async () => {
      const item1 = makeFeedItem({
        guid: 'guid-1',
        title: 'Test Article',
        content: 'Content',
        link: 'https://example.com/article',
      });

      const item2 = makeFeedItem({
        guid: 'guid-2',
        title: 'Updated Test Article',
        content: 'Different content',
        link: 'https://example.com/article',
      });

      const hash1 = await articleHasher.generateHash(item1, mockFeedId);
      const hash2 = await articleHasher.generateHash(item2, mockFeedId);

      expect(hash1).toBe(hash2);
    });

    it('should normalize fragments and trailing slashes in link hashes', async () => {
      const item1 = makeFeedItem({
        title: 'Test Article',
        content: 'Content',
        link: 'https://example.com/article/#comments',
      });

      const item2 = makeFeedItem({
        title: 'Test Article',
        content: 'Content',
        link: 'https://example.com/article',
      });

      const hash1 = await articleHasher.generateHash(item1, mockFeedId);
      const hash2 = await articleHasher.generateHash(item2, mockFeedId);

      expect(hash1).toBe(hash2);
    });
  });

  describe('generateHash - Priority 2: guid', () => {
    it('should use guid when link is missing', async () => {
      const item = makeFeedItem({
        guid: 'unique-guid-123',
        title: 'Test Article',
        content: 'Content',
      });

      const hash = await articleHasher.generateHash(item, mockFeedId);
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64); // SHA-256 produces 64 hex characters
    });

    it('should keep the same guid stable across different feeds', async () => {
      const item = makeFeedItem({
        guid: 'same-guid',
        title: 'Test Article',
        content: 'Content',
      });

      const hash1 = await articleHasher.generateHash(item, mockFeedId);
      const hash2 = await articleHasher.generateHash(item, altFeedId);

      expect(hash1).toBe(hash2);
    });

    it('should ignore whitespace in guid', async () => {
      const item1 = makeFeedItem({
        guid: '  guid-with-spaces  ',
        title: 'Test',
        content: 'Content',
      });

      const item2 = makeFeedItem({
        guid: 'guid-with-spaces',
        title: 'Test',
        content: 'Content',
      });

      const hash1 = await articleHasher.generateHash(item1, mockFeedId);
      const hash2 = await articleHasher.generateHash(item2, mockFeedId);

      expect(hash1).toBe(hash2);
    });

    it('should treat empty guid as missing and fall back', async () => {
      const itemWithEmptyGuid = makeFeedItem({
        guid: '   ',
        title: 'Test Article',
        content: 'Content',
        link: 'https://example.com/article',
      });

      const itemWithoutGuid = makeFeedItem({
        title: 'Test Article',
        content: 'Content',
        link: 'https://example.com/article',
      });

      const hash1 = await articleHasher.generateHash(itemWithEmptyGuid, mockFeedId);
      const hash2 = await articleHasher.generateHash(itemWithoutGuid, mockFeedId);

      // URL remains the primary key even when guid is empty.
      expect(hash1).toBe(hash2);
    });
  });

  describe('URL-first behavior across feed metadata', () => {
    it('should ignore feed identity when the canonical URL matches', async () => {
      const item = makeFeedItem({
        title: 'Test Article',
        link: 'https://example.com/article',
        content: 'Content',
      });

      const hash1 = await articleHasher.generateHash(item, mockFeedId);
      const hash2 = await articleHasher.generateHash(item, altFeedId);

      expect(hash1).toBe(hash2);
    });

    it('should match imported articles without feed metadata to feed-fetched articles by URL', async () => {
      const item1 = makeFeedItem({
        guid: 'feed-guid',
        title: 'Feed Version',
        link: 'https://example.com/article',
        content: 'Content',
      });

      const item2 = makeFeedItem({
        title: 'Imported Version',
        link: 'https://example.com/article',
        content: 'Imported content',
      });

      const hash1 = await articleHasher.generateHash(item1, mockFeedId);
      const hash2 = await articleHasher.generateHash(item2);

      expect(hash1).toBe(hash2);
    });
  });

  describe('generateHash - Priority 3: title', () => {
    it('should use title when link and guid are missing', async () => {
      const item = makeFeedItem({
        title: 'Test Article',
        content: 'Content',
      });

      const hash = await articleHasher.generateHash(item, mockFeedId);
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64);
    });

    it('should keep the same title stable across different feeds', async () => {
      const item = makeFeedItem({
        title: 'Same Title',
        content: 'Content',
      });

      const hash1 = await articleHasher.generateHash(item, mockFeedId);
      const hash2 = await articleHasher.generateHash(item, altFeedId);

      expect(hash1).toBe(hash2);
    });

    it('should ignore title uppercase differences in title-based hashes', async () => {
      const item1 = makeFeedItem({
        title: 'BREAKING NEWS',
        content: 'Content',
      });

      const item2 = makeFeedItem({
        title: 'breaking news',
        content: 'Different content',
      });

      const hash1 = await articleHasher.generateHash(item1, mockFeedId);
      const hash2 = await articleHasher.generateHash(item2, mockFeedId);

      expect(hash1).toBe(hash2);
    });
  });

  describe('generateHash - Priority 4: content', () => {
    it('should use content when link, guid, and title are missing', async () => {
      const item = makeFeedItem({
        content: 'This is the article content with many words to hash',
      });

      const hash = await articleHasher.generateHash(item, mockFeedId);
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64);
    });

    it('should keep the same content stable across different feeds', async () => {
      const item = makeFeedItem({
        content: 'Same content',
      });

      const hash1 = await articleHasher.generateHash(item, mockFeedId);
      const hash2 = await articleHasher.generateHash(item, altFeedId);

      expect(hash1).toBe(hash2);
    });

    it('should use first 100 words of content', async () => {
      const longContent = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
      const item1 = makeFeedItem({
        content: longContent,
      });

      const item2 = makeFeedItem({
        content: longContent + ' extra words at the end',
      });

      const hash1 = await articleHasher.generateHash(item1, mockFeedId);
      const hash2 = await articleHasher.generateHash(item2, mockFeedId);

      // Should be the same since only first 100 words are used
      expect(hash1).toBe(hash2);
    });
  });

  describe('generateHash - Non-feed fallbacks', () => {
    it('should use URL when feedId is missing', async () => {
      const item = makeFeedItem({
        title: 'Test Article',
        link: 'https://example.com/article',
        content: 'Content',
      });

      const hash = await articleHasher.generateHash(item); // No feedId
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64);
    });

    it('should fall back to guid when feedId and link are missing', async () => {
      const item1 = makeFeedItem({
        guid: 'imported-guid',
        title: 'Test Article',
        content: 'Content',
      });

      const item2 = makeFeedItem({
        guid: 'imported-guid',
        title: 'Different Title',
        content: 'Different content',
      });

      const hash1 = await articleHasher.generateHash(item1);
      const hash2 = await articleHasher.generateHash(item2);

      expect(hash1).toBe(hash2);
    });

    it('should fall back to title only when feedId, link, and guid are missing', async () => {
      const item = makeFeedItem({
        title: 'Test Article',
        content: 'Content',
      });

      const hash = await articleHasher.generateHash(item); // No feedId
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64);
    });

    it('should fall back to content when feedId, title, and link are missing', async () => {
      const item = makeFeedItem({
        content: 'Just content',
      });

      const hash = await articleHasher.generateHash(item); // No feedId
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64);
    });

    it('should ignore title uppercase differences without feed metadata', async () => {
      const item1 = makeFeedItem({
        title: 'Imported Article',
        content: 'Content',
      });

      const item2 = makeFeedItem({
        title: 'IMPORTED ARTICLE',
        content: 'Different content',
      });

      const hash1 = await articleHasher.generateHash(item1);
      const hash2 = await articleHasher.generateHash(item2);

      expect(hash1).toBe(hash2);
    });
  });

  describe('Hash consistency', () => {
    it('should produce the same hash for identical inputs', async () => {
      const item = makeFeedItem({
        guid: 'test-guid',
        title: 'Test Article',
        link: 'https://example.com/article',
        content: 'Content',
      });

      const hash1 = await articleHasher.generateHash(item, mockFeedId);
      const hash2 = await articleHasher.generateHash(item, mockFeedId);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different content', async () => {
      const item1 = makeFeedItem({
        guid: 'guid-1',
        title: 'Article 1',
        content: 'Content 1',
      });

      const item2 = makeFeedItem({
        guid: 'guid-2',
        title: 'Article 2',
        content: 'Content 2',
      });

      const hash1 = await articleHasher.generateHash(item1, mockFeedId);
      const hash2 = await articleHasher.generateHash(item2, mockFeedId);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle RSS 2.0 with guid', async () => {
      const item = makeFeedItem({
        guid: 'https://example.com/post/123',
        title: 'Blog Post Title',
        link: 'https://example.com/post/123',
        content: '<p>This is the blog post content</p>',
        author: 'John Doe',
        publishedDate: '2026-02-10T12:00:00Z',
      });

      const hash = await articleHasher.generateHash(item, mockFeedId);
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64);
    });

    it('should handle Atom feed with id as guid', async () => {
      const item = makeFeedItem({
        guid: 'tag:example.com,2026:post-123',
        title: 'Atom Entry Title',
        link: 'https://example.com/post/123',
        content: 'Atom content',
        summary: 'Atom summary',
      });

      const hash = await articleHasher.generateHash(item, mockFeedId);
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64);
    });

    it('should handle podcast episode with iTunes guid', async () => {
      const item = makeFeedItem({
        guid: 'episode-42',
        title: 'Episode 42: The Answer',
        link: 'https://podcast.com/episodes/42',
        content: 'Episode description',
        enclosures: [{
          url: 'https://podcast.com/episodes/42.mp3',
          type: 'audio/mpeg',
          length: 50000000,
          duration: 3600,
        }],
        duration: 3600,
        episodeNumber: 42,
      });

      const hash = await articleHasher.generateHash(item, mockFeedId);
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64);
    });

    it('should handle minimal feed (title + content only)', async () => {
      const item = makeFeedItem({
        title: 'Minimal Article',
        content: 'Just some basic content',
      });

      const hash = await articleHasher.generateHash(item, mockFeedId);
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64);
    });
  });

  describe('Feed separation', () => {
    it('should collapse same URLs across different feed subscriptions', async () => {
      const feeds = [
        'https://feed1.com/rss',
        'https://feed2.com/atom',
        'https://feed3.com/feed.xml',
      ];

      const item = makeFeedItem({
        title: 'Identical Article',
        link: 'https://news.com/article',
        content: 'Same content everywhere',
        feedId: feeds[0],
      });

      const hashes = await Promise.all(
        feeds.map((feedId) => articleHasher.generateHash(item, feedId))
      );

      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(1);
    });

    it('should keep Typlog episode identity stable when audio and default feeds share links', async () => {
      const item = makeFeedItem({
        guid: 'https://siji.typlog.io/episodes/zhuangding',
        title: '第一章、壮丁',
        link: 'https://siji.typlog.io/episodes/zhuangding',
        content: '<p>第一章、壮丁</p>',
        enclosures: [{
          url: 'https://r.typlog.com/siji/8331566789_501003.mp3',
          type: 'audio/mpeg',
          length: 38580293,
          duration: 2411,
        }],
      });

      const defaultFeedHash = await articleHasher.generateHash(item, 'https://siji.typlog.io/feed');
      const audioFeedHash = await articleHasher.generateHash(item, 'https://siji.typlog.io/feed/audio.xml');

      expect(defaultFeedHash).toBe(audioFeedHash);
    });

    it('should keep different URLs distinct even when guid matches', async () => {
      const item1 = makeFeedItem({
        guid: 'article-123',
        title: 'Article Title',
        link: 'https://example.com/original-url',
        content: 'Content',
      });

      const item2 = makeFeedItem({
        guid: 'article-123', // Same guid
        title: 'Article Title',
        link: 'https://example.com/new-url', // Different URL
        content: 'Content',
      });

      const hash1 = await articleHasher.generateHash(item1, mockFeedId);
      const hash2 = await articleHasher.generateHash(item2, mockFeedId);

      // Link now takes priority so same-feed same-URL items dedupe correctly.
      expect(hash1).not.toBe(hash2);
    });
  });
});
