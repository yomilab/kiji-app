import { XMLParser } from 'fast-xml-parser';
import { extractMainHost } from '@/utils/urlValidator';

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

export interface FaviconDiscoveryAdapter {
  fetchImageDataUrl: (url: string, signal?: AbortSignal) => Promise<string | null>;
  fetchText: (url: string, signal?: AbortSignal) => Promise<string>;
}

export interface DiscoverFaviconOptions {
  feedXmlText?: string;
  signal?: AbortSignal;
}

interface ParsedIcoMetadata {
  width: number;
  height: number;
  colorCount: number;
  bitCount: number;
  byteLength: number;
  imageCount: number;
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

    return Array.from(resolved);
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

  // Scan link tags once and keep only icon-like rel values to avoid full DOM parsing work.
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

  return Array.from(results);
}

function decodeBase64(base64: string): Uint8Array | null {
  try {
    if (typeof atob === 'function') {
      const binary = atob(base64);
      return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    }
  } catch {
    return null;
  }

  return null;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function extractIcoMetadata(dataUrl: string): ParsedIcoMetadata | null {
  const match = /^data:image\/(?:x-icon|vnd\.microsoft\.icon);base64,([^#?]+)$/i.exec(dataUrl);
  if (!match) {
    return null;
  }

  const bytes = decodeBase64(match[1]);
  if (!bytes || bytes.length < 22) {
    return null;
  }

  const reserved = readUint16LE(bytes, 0);
  const type = readUint16LE(bytes, 2);
  const imageCount = readUint16LE(bytes, 4);
  if (reserved !== 0 || type !== 1 || imageCount < 1) {
    return null;
  }

  return {
    width: bytes[6] || 256,
    height: bytes[7] || 256,
    colorCount: bytes[8],
    bitCount: readUint16LE(bytes, 12),
    byteLength: bytes.length,
    imageCount,
  };
}

function isLowQualityIcoFallback(dataUrl: string): boolean {
  const metadata = extractIcoMetadata(dataUrl);
  if (!metadata) {
    return false;
  }

  // Tiny single-entry monochrome ICO files are often generic placeholders.
  return (
    metadata.imageCount === 1
    && metadata.width <= 16
    && metadata.height <= 16
    && metadata.byteLength <= 256
    && (metadata.bitCount <= 4 || (metadata.colorCount > 0 && metadata.colorCount <= 4))
  );
}

async function tryCandidates(
  candidates: string[],
  adapter: FaviconDiscoveryAdapter,
  signal?: AbortSignal
): Promise<string | null> {
  for (const candidate of candidates) {
    const favicon = await adapter.fetchImageDataUrl(candidate, signal);
    if (favicon) {
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
  options: DiscoverFaviconOptions = {}
): Promise<string | null> {
  let targetUrl: URL;
  try {
    targetUrl = new URL(feedUrl);
  } catch {
    return null;
  }

  const origin = targetUrl.origin;
  const mainHost = extractMainHost(feedUrl);
  let lowQualityOriginFallback: string | null = null;
  let hasTriedGoogleProvider = false;

  // Try explicit feed-declared icons first because they are usually the most intentional source.
  if (options.feedXmlText) {
    const feedXmlFavicon = await tryCandidates(
      extractFeedXmlIconUrls(options.feedXmlText, feedUrl),
      adapter,
      options.signal
    );
    if (feedXmlFavicon) {
      return feedXmlFavicon;
    }
  }

  // Prefer the standard origin favicon for the cheap happy path, but keep obviously low-quality
  // placeholder ICOs as a fallback while continuing to look for site-declared icons.
  const originFavicon = await tryCandidates(
    [`${origin}/favicon.ico`],
    adapter,
    options.signal
  );
  if (originFavicon) {
    if (!isLowQualityIcoFallback(originFavicon)) {
      return originFavicon;
    }
    lowQualityOriginFallback = originFavicon;
  } else {
    // Use Google's favicon endpoint as the fast common fallback when the origin does not expose a
    // standard favicon at all, so feeds without local icon files can still resolve quickly.
    const googleProviderFavicon = await tryCandidates(
      buildGoogleProviderCandidates(origin, mainHost),
      adapter,
      options.signal
    );
    if (googleProviderFavicon) {
      return googleProviderFavicon;
    }
    hasTriedGoogleProvider = true;
  }

  // Prefer page-declared icons before external providers so we do not lock onto generic placeholders.
  try {
    const html = await adapter.fetchText(`${origin}/`, options.signal);
    const htmlFavicon = await tryCandidates(
      extractHtmlIconUrls(html, origin),
      adapter,
      options.signal
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
    options.signal
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

  return lowQualityOriginFallback;
}
