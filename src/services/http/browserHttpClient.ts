import { IHttpClient, HttpRequestOptions, FetchFeedResult } from './httpClient';

const createAbortError = () => {
  const error = new Error('Request was aborted');
  error.name = 'AbortError';
  return error;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw createAbortError();
  }
};

const createCompositeSignal = (timeout?: number, signal?: AbortSignal): AbortSignal | undefined => {
  const timeoutSignal = timeout ? AbortSignal.timeout(timeout) : undefined;
  if (!timeoutSignal) {
    return signal;
  }
  if (!signal) {
    return timeoutSignal;
  }
  return AbortSignal.any([signal, timeoutSignal]);
};

/**
 * Browser HTTP Client Implementation
 * 
 * Uses the standard fetch API for browser environments.
 * Note: This may have CORS restrictions in browser environments.
 */
export class BrowserHttpClient implements IHttpClient {
  async get(url: string, options?: HttpRequestOptions): Promise<string> {
    throwIfAborted(options?.signal);
    const headers: HeadersInit = {
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      ...options?.headers,
    };

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: createCompositeSignal(options?.timeout, options?.signal),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch ${url}: ${errorMessage}`);
    }
  }

  async getWithCache(url: string, options?: HttpRequestOptions): Promise<FetchFeedResult> {
    throwIfAborted(options?.signal);
    const headers: Record<string, string> = {
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      ...options?.headers,
    };

    if (options?.etag) {
      headers['If-None-Match'] = options.etag;
    }
    if (options?.lastModified) {
      headers['If-Modified-Since'] = options.lastModified;
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: createCompositeSignal(options?.timeout, options?.signal),
      });

      if (response.status === 304) {
        return { notModified: true };
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return {
        notModified: false,
        data: await response.text(),
        etag: response.headers.get('etag') || undefined,
        lastModified: response.headers.get('last-modified') || undefined,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch ${url}: ${errorMessage}`);
    }
  }
}
