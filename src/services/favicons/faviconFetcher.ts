import { tauriClient } from "../../lib/tauriClient";

export class FaviconFetcher {
  private cache = new Map<string, string | null>();
  private inFlightRequests = new Map<string, Promise<string | null>>();
  private readonly timeout = 5_000;
  private readonly maxCacheSize = 50;

  async fetchFavicon(feedUrl: string, feedXmlText?: string): Promise<string | null> {
    if (this.cache.has(feedUrl)) {
      return this.cache.get(feedUrl) ?? null;
    }

    const inFlight = this.inFlightRequests.get(feedUrl);
    if (inFlight) {
      return inFlight;
    }

    const fetchPromise = this.fetchFaviconInternal(feedUrl, feedXmlText).finally(() => {
      this.inFlightRequests.delete(feedUrl);
    });
    this.inFlightRequests.set(feedUrl, fetchPromise);
    return fetchPromise;
  }

  private async fetchFaviconInternal(feedUrl: string, feedXmlText?: string): Promise<string | null> {
    const origin = new URL(feedUrl).origin;
    const candidates = [
      ...this.extractFeedIconCandidates(feedUrl, feedXmlText),
      `${origin}/favicon.ico`,
      `${origin}/favicon.png`,
      `${origin}/apple-touch-icon.png`,
    ];

    for (const candidate of candidates) {
      const dataUrl = await this.fetchImage(candidate);
      if (dataUrl) {
        return this.cacheFavicon(feedUrl, dataUrl);
      }
    }

    return this.cacheFavicon(feedUrl, null);
  }

  private extractFeedIconCandidates(feedUrl: string, feedXmlText?: string): string[] {
    if (!feedXmlText) {
      return [];
    }

    try {
      const doc = new DOMParser().parseFromString(feedXmlText, "text/xml");
      const rawCandidates = [
        doc.querySelector("channel > image > url")?.textContent,
        doc.querySelector("feed > icon")?.textContent,
        doc.querySelector("feed > logo")?.textContent,
      ];
      return rawCandidates
        .map((candidate) => resolveUrl(candidate ?? "", feedUrl))
        .filter((candidate): candidate is string => !!candidate);
    } catch {
      return [];
    }
  }

  private async fetchImage(url: string): Promise<string | null> {
    try {
      const response = await tauriClient.feeds.fetchDataUrl({ url, timeout: this.timeout });
      return response.dataUrl.startsWith("data:image/") ? response.dataUrl : null;
    } catch {
      return null;
    }
  }

  private cacheFavicon(url: string, favicon: string | null): string | null {
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(url, favicon);
    return favicon;
  }
}

function resolveUrl(candidate: string, baseUrl: string): string | undefined {
  const trimmed = candidate.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return undefined;
  }
}

export const faviconFetcher = new FaviconFetcher();
