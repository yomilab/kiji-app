/**
 * Feed autodiscovery for the Add Feeds link lookup: turns a website address
 * into the feed(s) it publishes. Order: known-site rewrites (YouTube, Reddit,
 * GitHub, Mastodon) → the link itself as a feed → `<link rel="alternate">`
 * feeds declared by the page → a few common feed paths when none are
 * declared. Every request goes through the normal feed fetch (5 s timeout)
 * and the whole lookup is capped at {@link MAX_DISCOVERY_REQUESTS}.
 */
import { feedsFetcher, parseFeed, type FeedFetchResult } from '@/services/feeds/feedsFetcher';

/** Upper bound on network requests one lookup may make. */
export const MAX_DISCOVERY_REQUESTS = 6;
/** Most declared feeds offered in the pick list. */
export const MAX_FEED_CHOICES = 8;
/** Tried in order, only when the page declares no feed. */
export const COMMON_FEED_PATHS = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml'];

export type FeedCandidateType = 'rss' | 'atom' | 'json';

export interface FeedCandidate {
  url: string;
  title: string | null;
  type: FeedCandidateType;
}

export type FeedDiscoveryResult =
  | { kind: 'feed'; feedUrl: string; fetchResult: FeedFetchResult }
  | { kind: 'choices'; candidates: FeedCandidate[] };

/** The page was read but no feed could be found on it. */
export class FeedNotFoundError extends Error {
  constructor() {
    super('No feed found on this page');
    this.name = 'FeedNotFoundError';
  }
}

/** The lookup was replaced by a newer one; nothing more was fetched. */
export class FeedDiscoveryCancelledError extends Error {
  constructor() {
    super('Feed lookup was replaced');
    this.name = 'FeedDiscoveryCancelledError';
  }
}

export interface FeedDiscoveryDeps {
  fetchText: (url: string) => Promise<{ notModified: boolean; data?: string; etag?: string; lastModified?: string }>;
  parse: (text: string, url: string) => NonNullable<FeedFetchResult['items']>;
}

const defaultDeps: FeedDiscoveryDeps = {
  fetchText: (url) => feedsFetcher.fetchFeedNetworkWithCache(url),
  parse: parseFeed,
};

type FeedResponse = Awaited<ReturnType<FeedDiscoveryDeps['fetchText']>>;

const toFeedResult = (
  deps: FeedDiscoveryDeps,
  feedUrl: string,
  response: FeedResponse,
): Extract<FeedDiscoveryResult, { kind: 'feed' }> => {
  if (response.notModified || !response.data) {
    throw new Error('Received empty response from feed URL');
  }
  return {
    kind: 'feed',
    feedUrl,
    fetchResult: {
      notModified: false,
      data: response.data,
      items: deps.parse(response.data, feedUrl),
      etag: response.etag,
      lastModified: response.lastModified,
    },
  };
};

export interface FeedDiscoveryOptions {
  /** Return false once this lookup is stale; discovery then stops fetching. */
  isCurrent?: () => boolean;
  deps?: FeedDiscoveryDeps;
}

const FEED_TYPES: Record<string, FeedCandidateType> = {
  'application/rss+xml': 'rss',
  'application/atom+xml': 'atom',
  'application/feed+json': 'json',
  'application/json': 'json',
};

const parseUrl = (value: string, base?: string): URL | null => {
  try {
    const url = new URL(value, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
};

/** Same address ignoring the fragment and a trailing slash. */
const sameAddress = (a: string, b: string): boolean => {
  const key = (value: string) => {
    const url = parseUrl(value);
    if (!url) return value;
    url.hash = '';
    return url.href.replace(/\/$/, '');
  };
  return key(a) === key(b);
};

const hostIs = (url: URL, domain: string): boolean => (
  url.hostname === domain || url.hostname.endsWith(`.${domain}`)
);

const pathSegments = (url: URL): string[] => url.pathname.split('/').filter(Boolean);

export const youTubeChannelFeedUrl = (channelId: string): string => (
  `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`
);

export const youTubePlaylistFeedUrl = (playlistId: string): string => (
  `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`
);

const isYouTube = (url: URL): boolean => hostIs(url, 'youtube.com');

/** `youtube.com/@handle`, `/c/name` and `/user/name` need the page to learn the channel id. */
export const isYouTubeHandleUrl = (value: string): boolean => {
  const url = parseUrl(value);
  if (!url || !isYouTube(url)) return false;
  const [first, second] = pathSegments(url);
  return Boolean(first && (first.startsWith('@') || ((first === 'c' || first === 'user') && second)));
};

const GITHUB_RESERVED = new Set([
  'about', 'collections', 'enterprise', 'events', 'explore', 'features', 'issues', 'login', 'marketplace',
  'new', 'notifications', 'orgs', 'organizations', 'pricing', 'pulls', 'search', 'settings', 'sponsors',
  'topics', 'trending',
]);

/**
 * Feed address for sites whose feeds follow a fixed pattern, or null.
 * No network: the caller still fetches the result to confirm it.
 */
export const knownSiteFeedUrl = (value: string): string | null => {
  const url = parseUrl(value);
  if (!url) return null;
  const segments = pathSegments(url);

  if (isYouTube(url)) {
    if (segments[0] === 'channel' && /^UC[\w-]{10,}$/.test(segments[1] ?? '')) {
      return youTubeChannelFeedUrl(segments[1]);
    }
    const list = url.searchParams.get('list');
    if (segments[0] === 'playlist' && list) {
      return youTubePlaylistFeedUrl(list);
    }
    return null;
  }

  if (hostIs(url, 'reddit.com')) {
    if (url.pathname.endsWith('.rss')) return null;
    const [kind, name] = segments;
    if (kind === 'r' && name) return `https://www.reddit.com/r/${name}/.rss`;
    if ((kind === 'user' || kind === 'u') && name) return `https://www.reddit.com/user/${name}/.rss`;
    return null;
  }

  if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
    const [owner, repo] = segments;
    if (!owner || !repo || GITHUB_RESERVED.has(owner.toLowerCase()) || /\.atom$/.test(url.pathname)) {
      return null;
    }
    return `https://github.com/${owner}/${repo.replace(/\.git$/, '')}/releases.atom`;
  }

  // Mastodon (and compatible) profiles: https://instance/@user → @user.rss.
  // Medium also uses /@user but serves its feed elsewhere; page discovery covers it.
  if (
    segments.length === 1
    && /^@[\w.-]+$/.test(segments[0])
    && !hostIs(url, 'medium.com')
  ) {
    return `${url.origin}/${segments[0]}.rss`;
  }

  return null;
};

/** True when the text is an HTML page rather than a feed. */
export const looksLikeHtml = (text: string): boolean => {
  const head = text.slice(0, 2048).replace(/^﻿/, '').trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:!doctype\s+html|html|head|meta|title|body)\b/i.test(head)) {
    return true;
  }
  return false;
};

const looksLikeHtmlAnywhere = (text: string): boolean => /<html[\s>]/i.test(text.slice(0, 65536));

const parseHtml = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

/**
 * Feeds the page declares with `<link rel="alternate">`, resolved against
 * the page (or its `<base href>`) and de-duplicated, in page order.
 */
export const extractFeedLinks = (html: string, pageUrl: string): FeedCandidate[] => {
  const doc = parseHtml(html);
  const baseHref = doc.querySelector('base[href]')?.getAttribute('href');
  const base = (baseHref && parseUrl(baseHref, pageUrl)?.href) || pageUrl;
  const seen = new Set<string>();
  const candidates: FeedCandidate[] = [];

  for (const link of Array.from(doc.querySelectorAll('link[href]'))) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    if (!rel.includes('alternate')) continue;
    const mime = (link.getAttribute('type') ?? '').toLowerCase().split(';')[0].trim();
    const type = FEED_TYPES[mime];
    if (!type) continue;
    const href = link.getAttribute('href')?.trim() ?? '';
    const resolved = parseUrl(href, base);
    if (!resolved) continue;
    // Plain JSON alternates are usually API documents (e.g. WordPress
    // /wp-json/), not feeds; keep them only when they look like one.
    if (mime === 'application/json' && !/feed/i.test(`${resolved.pathname} ${link.getAttribute('title') ?? ''}`)) {
      continue;
    }
    resolved.hash = '';
    const key = resolved.href;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ url: key, title: link.getAttribute('title')?.trim() || null, type });
  }
  return candidates;
};

/** YouTube channel id from a channel page (canonical link first, then page data). */
export const extractYouTubeChannelId = (html: string): string | null => {
  const doc = parseHtml(html);
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '';
  const fromCanonical = canonical.match(/\/channel\/(UC[\w-]{10,})/);
  if (fromCanonical) return fromCanonical[1];
  const meta = doc.querySelector('meta[itemprop="channelId"], meta[itemprop="identifier"]')?.getAttribute('content');
  if (meta && /^UC[\w-]{10,}$/.test(meta)) return meta;
  const fromData = html.match(/"(?:externalId|channelId)"\s*:\s*"(UC[\w-]{10,})"/);
  return fromData ? fromData[1] : null;
};

export const feedTypeLabel = (type: FeedCandidateType): string => (
  type === 'atom' ? 'Atom' : type === 'json' ? 'JSON Feed' : 'RSS'
);

/**
 * Look a link up and return the one feed it leads to, or several declared
 * feeds to choose from. Errors from the first page fetch (timeouts, HTTP
 * errors) propagate; a page with no feed throws {@link FeedNotFoundError}.
 */
export const discoverFeeds = async (
  pageUrl: string,
  options: FeedDiscoveryOptions = {},
): Promise<FeedDiscoveryResult> => {
  const deps = options.deps ?? defaultDeps;
  const isCurrent = options.isCurrent ?? (() => true);
  let requestsLeft = MAX_DISCOVERY_REQUESTS;

  const fetchText = async (url: string) => {
    if (!isCurrent()) throw new FeedDiscoveryCancelledError();
    requestsLeft -= 1;
    const result = await deps.fetchText(url);
    if (!isCurrent()) throw new FeedDiscoveryCancelledError();
    return result;
  };

  const toFeed = (feedUrl: string, response: FeedResponse) => toFeedResult(deps, feedUrl, response);

  // Fetch and parse a guessed address; a miss is quiet (null).
  const tryFeed = async (feedUrl: string): Promise<FeedDiscoveryResult | null> => {
    if (requestsLeft <= 0) return null;
    try {
      return toFeed(feedUrl, await fetchText(feedUrl));
    } catch (error) {
      if (error instanceof FeedDiscoveryCancelledError) throw error;
      return null;
    }
  };

  const knownFeedUrl = knownSiteFeedUrl(pageUrl);
  if (knownFeedUrl) {
    const known = await tryFeed(knownFeedUrl);
    if (known) return known;
  }

  const page = await fetchText(pageUrl);
  if (page.notModified || !page.data) {
    throw new Error('Received empty response from feed URL');
  }
  const text = page.data;

  if (!looksLikeHtml(text)) {
    try {
      return toFeed(pageUrl, page);
    } catch (parseError) {
      if (!looksLikeHtmlAnywhere(text)) throw parseError;
    }
  }

  if (isYouTubeHandleUrl(pageUrl)) {
    const channelId = extractYouTubeChannelId(text);
    if (channelId) {
      const channelFeed = await tryFeed(youTubeChannelFeedUrl(channelId));
      if (channelFeed) return channelFeed;
    }
  }

  const declared = extractFeedLinks(text, pageUrl).filter((candidate) => !sameAddress(candidate.url, pageUrl));
  if (declared.length > 1) {
    return { kind: 'choices', candidates: declared.slice(0, MAX_FEED_CHOICES) };
  }
  if (declared.length === 1) {
    const only = await tryFeed(declared[0].url);
    if (only) return only;
    throw new FeedNotFoundError();
  }

  const origin = parseUrl(pageUrl)?.origin;
  if (origin) {
    for (const path of COMMON_FEED_PATHS) {
      if (requestsLeft <= 0) break;
      const guess = `${origin}${path}`;
      if (sameAddress(guess, pageUrl)) continue;
      const found = await tryFeed(guess);
      if (found) return found;
    }
  }
  throw new FeedNotFoundError();
};

/** Fetch one chosen feed address (from the pick list) and parse it. */
export const fetchChosenFeed = async (
  feedUrl: string,
  options: FeedDiscoveryOptions = {},
): Promise<Extract<FeedDiscoveryResult, { kind: 'feed' }>> => {
  const deps = options.deps ?? defaultDeps;
  const response = await deps.fetchText(feedUrl);
  if (options.isCurrent && !options.isCurrent()) throw new FeedDiscoveryCancelledError();
  return toFeedResult(deps, feedUrl, response);
};
