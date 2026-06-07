import { tauriClient } from '../../lib/tauriClient';
import { discoverFaviconDataUrl } from './faviconDiscovery';

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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const favicon = await discoverFaviconDataUrl(feedUrl, {
        fetchImageDataUrl: async (url, signal) => this.fetchImage(url, signal),
        fetchText: async (url, signal) => this.fetchText(url, signal),
      }, {
        feedXmlText,
        signal: controller.signal,
      });

      return this.cacheFavicon(feedUrl, favicon);
    } catch {
      return this.cacheFavicon(feedUrl, null);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async fetchImage(url: string, signal?: AbortSignal): Promise<string | null> {
    if (signal?.aborted) {
      return null;
    }

    try {
      const response = await tauriClient.feeds.fetchDataUrl({ url, timeout: this.timeout });
      return response.dataUrl.startsWith('data:image/') ? response.dataUrl : null;
    } catch {
      return null;
    }
  }

  private async fetchText(url: string, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) {
      throw new DOMException('Task aborted', 'AbortError');
    }

    if (window.electronAPI?.fetchHtmlSafe) {
      const result = await window.electronAPI.fetchHtmlSafe(url);
      if (result.resourceType === 'html' && result.html) {
        return result.html;
      }

      throw new Error(`Non-HTML content type: ${result.contentType}`);
    }

    return tauriClient.feeds.fetch({ url });
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

export const faviconFetcher = new FaviconFetcher();
