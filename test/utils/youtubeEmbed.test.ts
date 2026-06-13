import { describe, expect, it } from 'vitest';

import {
  buildYouTubeWatchUrl,
  extractYouTubeEmbedTarget,
  isYouTubeEmbedNavigationUrl,
  isYouTubeInlineEmbedPageUrl,
  resolveYouTubeWatchUrl,
} from '@/utils/youtubeEmbed';

describe('youtubeEmbed utils', () => {
  it('builds watch urls from embed targets', () => {
    expect(buildYouTubeWatchUrl({ videoId: 'dQw4w9WgXcQ', startSeconds: 30 })).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30',
    );
  });

  it('rewrites youtube embed urls to watch urls for external open', () => {
    expect(resolveYouTubeWatchUrl('https://www.youtube.com/embed/dQw4w9WgXcQ?start=15')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=15',
    );
    expect(resolveYouTubeWatchUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
    expect(resolveYouTubeWatchUrl('https://example.com/article')).toBeNull();
  });

  it('classifies embed vs inline shell urls for navigation policy', () => {
    expect(isYouTubeEmbedNavigationUrl('https://www.youtube-nocookie.com/embed/abc123')).toBe(true);
    expect(isYouTubeEmbedNavigationUrl('https://tauri.localhost/youtube-embed.html?v=abc123')).toBe(false);
    expect(isYouTubeInlineEmbedPageUrl('https://tauri.localhost/youtube-embed.html?v=abc123')).toBe(true);
  });

  it('extracts shorts and live urls', () => {
    expect(extractYouTubeEmbedTarget('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.videoId).toBe(
      'dQw4w9WgXcQ',
    );
  });
});
