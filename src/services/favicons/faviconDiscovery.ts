import { XMLParser } from 'fast-xml-parser';
import { extractMainHost } from '@/utils/urlValidator';
import {
  isLowQualityIcoDataUrl,
  isPlaceholderFaviconDataUrl,
  isUsableFaviconDataUrl,
} from './faviconQuality';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: true,
});

const COMMON_ICON_PATHS = [
  '/favicon.png',
  '/favicon.jpg',
  '/favicon.jpeg',
  '/apple-touch-icon.png',
  '/apple-touch-icon-precomposed.png',
];

const HTML_ICON_RELS = new Set([
  'icon',
  'shortcut icon',
  'apple-touch-icon',
  'apple-touch-icon-precomposed',
  'mask-icon',
]);

const GOOGLE_FAVICON_SIZES = [128, 64] as const;
const WORDPRESS_ICON_WIDTH_HINTS = [192, 180, 128, 96, 64, 48, 32];

export interface FaviconDiscoveryAdapter {
  fetchImageDataUrl: (url: string, signal?: AbortSignal) => Promise<string | null>;
  fetchText: (url: string, signal?: AbortSignal) => Promise<string>;
}

export interface DiscoverFaviconOptions {
  feedXmlText?: string;
  signal?: AbortSignal;
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/\.\w{2,4}\/$/.test(trimmed)) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}

function resolveUrl(base: string, relative: string): string | null {
  try {
    return normalizeUrl(new URL(relative, base).toString());
  } catch {
    return null;
  }
}

function readStringCandidates(value: unknown): string[] {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(readStringCandidates);
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.url !== undefined) {
      return readStringCandidates(record.url);
    }
    if (record.href !== undefined) {
      return readStringCandidates(record.href);
    }
    if (record['#text'] !== undefined) {
      return readStringCandidates(record['#text']);
    }
  }

  return [];
}

function estimateIconCandidateSize(url: string): number {
  try {
    const parsed = new URL(url);
    const widthParam = parsed.searchParams.get('w') ?? parsed.searchParams.get('width');
    if (widthParam) {
      const width = Number.parseInt(widthParam, 10);
      if (Number.isFinite(width) && width > 0) {
        return width;
      }
    }

    const sizeMatch = /[-_/](\d{2,3})x\d{2,3}\./i.exec(parsed.pathname);
    if (sizeMatch) {
      return Number.parseInt(sizeMatch[1], 10);
    }
  } catch {
    // Ignore malformed URLs in sorting.
  }

  return 0;
}

function expandFeedIconCandidates(urls: string[]): string[] {
  const expanded = new Set<string>();

  for (const url of urls) {
    expanded.add(url);

    try {
      const parsed = new URL(url);
      if (!parsed.search) {
        continue;
      }

      const withoutQuery = normalizeUrl(`${parsed.origin}${parsed.pathname}`);
      expanded.add(withoutQuery);

      const hasWidthHint = parsed.searchParams.has('w') || parsed.searchParams.has('width');
      if (hasWidthHint) {
        for (const width of WORDPRESS_ICON_WIDTH_HINTS) {
          const next = new URL(parsed.toString());
          next.searchParams.set('w', String(width));
          expanded.add(normalizeUrl(next.toString()));
        }
      }
    } catch {
      // Keep the original candidate only.
    }
  }

  return Array.from(expanded);
}

function sortIconCandidatesByPreferredSize(candidates: string[]): string[] {
  return [...candidates].sort((left, right) => estimateIconCandidateSize(right) - estimateIconCandidateSize(left));
}

function extractFeedXmlIconUrls(feedXmlText: string, feedUrl: string): string[] {
  try {
    const parsed = parser.parse(feedXmlText) as Record<string, unknown>;
    const rss = parsed.rss as Record<string, unknown> | undefined;
    const channel = rss?.channel as Record<string, unknown> | undefined;
    const atomFeed = parsed.feed as Record<string, unknown> | undefined;
    const candidates = [
      ...readStringCandidates(channel?.image),
      ...readStringCandidates(channel?.icon),
      ...readStringCandidates(atomFeed?.icon),
      ...readStringCandidates(atomFeed?.logo),
    ];

    const resolved = new Set<string>();
    for (const candidate of candidates) {
      const url = resolveUrl(feedUrl, candidate);
      if (url) {
        resolved.add(url);
      }
    }

    return expandFeedIconCandidates(Array.from(resolved));
  } catch {
    return [];
  }
}

function extractAttributeValue(tag: string, attribute: string): string | null {
  const match = new RegExp(`${attribute}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match?.[2] || match?.[3] || match?.[4] || null;
}

function extractHtmlIconUrls(html: string, origin: string): string[] {
  const results = new Set<string>();
  const tags = html.match(/<link\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const relValue = extractAttributeValue(tag, 'rel');
    const hrefValue = extractAttributeValue(tag, 'href');
    if (!relValue || !hrefValue) {
      continue;
    }

    const normalizedRel = relValue.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!HTML_ICON_RELS.has(normalizedRel)) {
      continue;
    }

    const absoluteUrl = resolveUrl(origin, hrefValue);
    if (absoluteUrl) {
      results.add(absoluteUrl);
    }
  }

  return sortIconCandidatesByPreferredSize(Array.from(results));
}

async function tryCandidates(
  candidates: string[],
  adapter: FaviconDiscoveryAdapter,
  signal?: AbortSignal,
): Promise<string | null> {
  const orderedCandidates = sortIconCandidatesByPreferredSize(candidates);

  for (const candidate of orderedCandidates) {
    const favicon = await adapter.fetchImageDataUrl(candidate, signal);
    if (!favicon) {
      continue;
    }

    if (await isUsableFaviconDataUrl(favicon)) {
      return favicon;
    }
  }

  return null;
}

function buildGoogleProviderCandidates(origin: string, mainHost: string): string[] {
  return GOOGLE_FAVICON_SIZES.flatMap((size) => [
    `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(origin)}&sz=${size}`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(mainHost)}&sz=${size}`,
  ]);
}

export async function discoverFaviconDataUrl(
  feedUrl: string,
  adapter: FaviconDiscoveryAdapter,
  options: DiscoverFaviconOptions = {},
): Promise<string | null> {
  let targetUrl: URL;
  try {
    targetUrl = new URL(feedUrl);
  } catch {
    return null;
  }

  const origin = targetUrl.origin;
  const mainHost = extractMainHost(feedUrl);
  let hasTriedGoogleProvider = false;

  if (options.feedXmlText) {
    const feedXmlFavicon = await tryCandidates(
      extractFeedXmlIconUrls(options.feedXmlText, feedUrl),
      adapter,
      options.signal,
    );
    if (feedXmlFavicon) {
      return feedXmlFavicon;
    }
  }

  const originFavicon = await tryCandidates(
    [`${origin}/favicon.ico`],
    adapter,
    options.signal,
  );
  if (originFavicon) {
    return originFavicon;
  }

  const googleProviderFavicon = await tryCandidates(
    buildGoogleProviderCandidates(origin, mainHost),
    adapter,
    options.signal,
  );
  if (googleProviderFavicon) {
    return googleProviderFavicon;
  }
  hasTriedGoogleProvider = true;

  try {
    const html = await adapter.fetchText(`${origin}/`, options.signal);
    const htmlFavicon = await tryCandidates(
      extractHtmlIconUrls(html, origin),
      adapter,
      options.signal,
    );
    if (htmlFavicon) {
      return htmlFavicon;
    }
  } catch {
    // Fall through to common paths.
  }

  const commonPathFavicon = await tryCandidates(
    COMMON_ICON_PATHS.map((path) => `${origin}${path}`),
    adapter,
    options.signal,
  );
  if (commonPathFavicon) {
    return commonPathFavicon;
  }

  const providerCandidates = [
    ...(hasTriedGoogleProvider ? [] : buildGoogleProviderCandidates(origin, mainHost)),
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(mainHost)}.ico`,
  ];
  const providerFavicon = await tryCandidates(providerCandidates, adapter, options.signal);
  if (providerFavicon) {
    return providerFavicon;
  }

  return null;
}

export const __faviconDiscoveryTestUtils = {
  extractFeedXmlIconUrls,
  extractHtmlIconUrls,
  sortIconCandidatesByPreferredSize,
  isLowQualityIcoDataUrl,
  isPlaceholderFaviconDataUrl,
};
