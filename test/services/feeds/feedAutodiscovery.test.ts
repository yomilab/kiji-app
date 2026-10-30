import { describe, expect, it, vi } from 'vitest';
import {
  COMMON_FEED_PATHS,
  discoverFeeds,
  extractFeedLinks,
  extractYouTubeChannelId,
  FeedDiscoveryCancelledError,
  FeedNotFoundError,
  knownSiteFeedUrl,
  looksLikeFeedAddress,
  MAX_DISCOVERY_REQUESTS,
  type FeedDiscoveryDeps,
} from '@/services/feeds/feedAutodiscovery';

const RSS = '<?xml version="1.0"?><rss><channel><title>Feed</title><item><title>One</title></item></channel></rss>';
const CHANNEL_ID = 'UCabcdefghijklmnopqrstuv';

const page = (head: string, body = '') => `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

/** Fake network: url → body; anything else is a 404. */
const fakeDeps = (responses: Record<string, string>) => {
  const fetchText = vi.fn(async (url: string) => {
    if (!(url in responses)) throw new Error('HTTP 404');
    return { notModified: false, data: responses[url], etag: 'etag-x' };
  });
  const parse = vi.fn((text: string) => {
    if (!text.trimStart().startsWith('<?xml') && !text.trimStart().startsWith('<rss')) {
      throw new Error('Feed format not recognized.');
    }
    return [{ title: 'One' }] as never;
  });
  const deps: FeedDiscoveryDeps = { fetchText, parse };
  return { deps, fetchText };
};

describe('extractFeedLinks', () => {
  it('resolves relative and absolute alternates and drops duplicates and non-feeds', () => {
    const html = page(`
      <link rel="alternate" type="application/rss+xml" title="Posts" href="/feed.xml">
      <link rel="alternate" type="application/atom+xml" title="Atom" href="https://blog.example/atom.xml">
      <link rel="alternate" type="application/rss+xml" title="Posts again" href="https://blog.example/feed.xml#top">
      <link rel="Alternate Home" type="application/feed+json" href="feed.json">
      <link rel="alternate" type="application/json" href="/wp-json/wp/v2/pages/2">
      <link rel="alternate" hreflang="de" href="/de/">
      <link rel="stylesheet" type="application/rss+xml" href="/not-a-feed.xml">
    `);

    expect(extractFeedLinks(html, 'https://blog.example/posts/hello')).toEqual([
      { url: 'https://blog.example/feed.xml', title: 'Posts', type: 'rss' },
      { url: 'https://blog.example/atom.xml', title: 'Atom', type: 'atom' },
      { url: 'https://blog.example/posts/feed.json', title: null, type: 'json' },
    ]);
  });

  it('resolves against <base href>', () => {
    const html = page('<base href="https://cdn.example/site/"><link rel="alternate" type="application/rss+xml" href="rss">');
    expect(extractFeedLinks(html, 'https://example.com/')[0].url).toBe('https://cdn.example/site/rss');
  });
});

describe('knownSiteFeedUrl', () => {
  it.each([
    [`https://www.youtube.com/channel/${CHANNEL_ID}`, `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`],
    ['https://youtube.com/playlist?list=PL123abc', 'https://www.youtube.com/feeds/videos.xml?playlist_id=PL123abc'],
    ['https://www.reddit.com/r/programming/', 'https://www.reddit.com/r/programming/.rss'],
    ['https://old.reddit.com/r/rust/top/?t=week', 'https://www.reddit.com/r/rust/.rss'],
    ['https://www.reddit.com/user/spez', 'https://www.reddit.com/user/spez/.rss'],
    ['https://www.reddit.com/u/spez', 'https://www.reddit.com/user/spez/.rss'],
    ['https://github.com/tauri-apps/tauri', 'https://github.com/tauri-apps/tauri/releases.atom'],
    ['https://github.com/tauri-apps/tauri/releases', 'https://github.com/tauri-apps/tauri/releases.atom'],
    ['https://mastodon.social/@Gargron', 'https://mastodon.social/@Gargron.rss'],
  ])('%s → %s', (input, expected) => {
    expect(knownSiteFeedUrl(input)).toBe(expected);
  });

  it.each([
    'https://www.youtube.com/@somehandle',
    'https://www.reddit.com/r/programming/.rss',
    'https://github.com/settings/profile',
    'https://github.com/tauri-apps',
    'https://medium.com/@someone',
    'https://example.com/blog',
  ])('leaves %s alone', (input) => {
    expect(knownSiteFeedUrl(input)).toBeNull();
  });
});

describe('looksLikeFeedAddress', () => {
  it.each([
    'https://justmysocks.net/members/index.php?rp=/announcements/rss',
    'https://example.com/feed',
    'https://example.com/blog/rss/',
    'https://example.com/atom.xml',
    'https://example.com/index.php?format=feed&type=rss',
    'https://example.com/posts.rdf',
    'https://www.youtube.com/feeds/videos.xml?channel_id=x',
  ])('%s is a feed address', (url) => {
    expect(looksLikeFeedAddress(url)).toBe(true);
  });

  it.each([
    'https://example.com/',
    'https://example.com/feedback',
    'https://example.com/press',
    'https://example.com/blog/my-post',
    'https://example.com/?q=%E0%A4%A',
  ])('%s is not', (url) => {
    expect(looksLikeFeedAddress(url)).toBe(false);
  });
});

describe('extractYouTubeChannelId', () => {
  it('prefers the canonical channel link', () => {
    const html = page(`<link rel="canonical" href="https://www.youtube.com/channel/${CHANNEL_ID}">`, '"channelId":"UCzzzzzzzzzzzzzzzzzzzzzz"');
    expect(extractYouTubeChannelId(html)).toBe(CHANNEL_ID);
  });

  it('falls back to the channelId in the page data', () => {
    expect(extractYouTubeChannelId(page('', `<script>var x = {"channelId":"${CHANNEL_ID}"}</script>`))).toBe(CHANNEL_ID);
  });
});

describe('discoverFeeds', () => {
  it('returns a link that already is a feed as-is with one request', async () => {
    const { deps, fetchText } = fakeDeps({ 'https://example.com/rss.xml': RSS });
    const result = await discoverFeeds('https://example.com/rss.xml', { deps });

    expect(result).toMatchObject({ kind: 'feed', feedUrl: 'https://example.com/rss.xml' });
    expect(result.kind === 'feed' && result.fetchResult.data).toBe(RSS);
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it('offers a pick list when the page declares several feeds', async () => {
    const html = page(`
      <link rel="alternate" type="application/rss+xml" title="Posts" href="/feed/">
      <link rel="alternate" type="application/rss+xml" title="Comments" href="https://example.com/comments/feed/">
      <link rel="alternate" type="application/rss+xml" title="Posts" href="https://example.com/feed/">
    `);
    const { deps, fetchText } = fakeDeps({ 'https://example.com/': html });
    const result = await discoverFeeds('https://example.com/', { deps });

    expect(result).toEqual({
      kind: 'choices',
      candidates: [
        { url: 'https://example.com/feed/', title: 'Posts', type: 'rss' },
        { url: 'https://example.com/comments/feed/', title: 'Comments', type: 'rss' },
      ],
    });
    // Candidates are fetched only once the user picks one.
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it('follows a single declared feed straight to its preview', async () => {
    const html = page('<link rel="alternate" type="application/atom+xml" href="atom.xml">');
    const { deps } = fakeDeps({ 'https://example.com/blog/': html, 'https://example.com/blog/atom.xml': RSS });

    expect(await discoverFeeds('https://example.com/blog/', { deps })).toMatchObject({
      kind: 'feed',
      feedUrl: 'https://example.com/blog/atom.xml',
    });
  });

  it('tries common feed paths when the page declares none', async () => {
    const { deps, fetchText } = fakeDeps({
      'https://example.com/about': page('<title>About</title>'),
      'https://example.com/rss.xml': RSS,
    });
    const result = await discoverFeeds('https://example.com/about', { deps });

    expect(result).toMatchObject({ kind: 'feed', feedUrl: 'https://example.com/rss.xml' });
    expect(fetchText.mock.calls.map(([url]) => url)).toEqual([
      'https://example.com/about',
      ...COMMON_FEED_PATHS.slice(0, MAX_DISCOVERY_REQUESTS - 1).map((path) => `https://example.com${path}`),
    ]);
  });

  it('probes the common feed paths at the same time and keeps their order of preference', async () => {
    const pending = new Map<string, (data: string) => void>();
    const deps: FeedDiscoveryDeps = {
      fetchText: vi.fn((url: string) => {
        if (url === 'https://example.com/') return Promise.resolve({ notModified: false, data: page('<title>Home</title>') });
        return new Promise((resolve, reject) => {
          pending.set(url, (data) => (data ? resolve({ notModified: false, data }) : reject(new Error('HTTP 404'))));
        });
      }),
      parse: fakeDeps({}).deps.parse,
    };
    const lookup = discoverFeeds('https://example.com/', { deps });
    await vi.waitFor(() => expect(pending.size).toBe(MAX_DISCOVERY_REQUESTS - 1));

    // A later path answering first does not beat an earlier one still in flight.
    pending.get('https://example.com/feed.xml')!(RSS);
    pending.get('https://example.com/feed')!('');
    pending.get('https://example.com/rss')!(RSS);

    // /atom.xml and /index.xml never answer; the lookup does not wait for them.
    expect(await lookup).toMatchObject({ kind: 'feed', feedUrl: 'https://example.com/rss' });
  });

  it('tries a feed address once more when it answers with a web page', async () => {
    const url = 'https://justmysocks.net/members/index.php?rp=/announcements/rss';
    const { deps, fetchText } = fakeDeps({ [url]: RSS });
    fetchText.mockImplementationOnce(async () => ({ notModified: false, data: page('<title>Error</title>') }));

    expect(await discoverFeeds(url, { deps })).toMatchObject({ kind: 'feed', feedUrl: url });
    expect(fetchText.mock.calls.map(([called]) => called)).toEqual([url, url]);
  });

  it('does not repeat a plain page address that has no feed', async () => {
    const { deps, fetchText } = fakeDeps({ 'https://example.com/about': page('<title>About</title>') });

    await expect(discoverFeeds('https://example.com/about', { deps })).rejects.toBeInstanceOf(FeedNotFoundError);
    expect(fetchText.mock.calls.filter(([called]) => called === 'https://example.com/about')).toHaveLength(1);
  });

  it('caps the requests and then says no feed was found', async () => {
    const { deps, fetchText } = fakeDeps({ 'https://example.com/': page('<title>Home</title>') });

    await expect(discoverFeeds('https://example.com/', { deps })).rejects.toBeInstanceOf(FeedNotFoundError);
    expect(fetchText).toHaveBeenCalledTimes(MAX_DISCOVERY_REQUESTS);
    expect(MAX_DISCOVERY_REQUESTS).toBeLessThanOrEqual(1 + COMMON_FEED_PATHS.length);
  });

  it('passes page fetch errors through (e.g. timeouts)', async () => {
    const deps: FeedDiscoveryDeps = {
      fetchText: vi.fn(async () => { throw new Error('Feed request timed out.'); }),
      parse: vi.fn(),
    };
    await expect(discoverFeeds('https://slow.example/', { deps })).rejects.toThrow('timed out');
  });

  it('keeps the parse error for a non-HTML response that is not a feed', async () => {
    const { deps } = fakeDeps({ 'https://example.com/data.txt': 'just text' });
    await expect(discoverFeeds('https://example.com/data.txt', { deps })).rejects.toThrow('not recognized');
  });

  it('resolves a YouTube handle through the channel id on its page', async () => {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
    const { deps, fetchText } = fakeDeps({
      'https://www.youtube.com/@somehandle': page(`<link rel="canonical" href="https://www.youtube.com/channel/${CHANNEL_ID}">`),
      [feedUrl]: RSS,
    });

    expect(await discoverFeeds('https://www.youtube.com/@somehandle', { deps })).toMatchObject({ kind: 'feed', feedUrl });
    expect(fetchText).toHaveBeenCalledTimes(2);
  });

  it('goes straight to the feed for a YouTube channel URL', async () => {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
    const { deps, fetchText } = fakeDeps({ [feedUrl]: RSS });

    expect(await discoverFeeds(`https://www.youtube.com/channel/${CHANNEL_ID}`, { deps })).toMatchObject({ kind: 'feed', feedUrl });
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it('goes straight to the .rss feed for a subreddit', async () => {
    const { deps, fetchText } = fakeDeps({ 'https://www.reddit.com/r/rust/.rss': RSS });

    expect(await discoverFeeds('https://www.reddit.com/r/rust', { deps })).toMatchObject({
      kind: 'feed',
      feedUrl: 'https://www.reddit.com/r/rust/.rss',
    });
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it('falls back to the page when a known-site guess fails', async () => {
    const html = page('<link rel="alternate" type="application/rss+xml" href="/feed.rss">');
    const { deps } = fakeDeps({ 'https://social.example/@me': html, 'https://social.example/feed.rss': RSS });

    expect(await discoverFeeds('https://social.example/@me', { deps })).toMatchObject({
      kind: 'feed',
      feedUrl: 'https://social.example/feed.rss',
    });
  });

  it('stops fetching once the lookup is stale', async () => {
    let current = true;
    const { deps, fetchText } = fakeDeps({ 'https://example.com/': page('<title>Home</title>') });
    fetchText.mockImplementationOnce(async () => {
      current = false;
      return { notModified: false, data: page('<title>Home</title>'), etag: undefined };
    });

    await expect(discoverFeeds('https://example.com/', { deps, isCurrent: () => current }))
      .rejects.toBeInstanceOf(FeedDiscoveryCancelledError);
    expect(fetchText).toHaveBeenCalledTimes(1);
  });
});
