/**
 * HTTP Client Interface
 * 
 * Abstract interface for making HTTP requests.
 * This allows swapping the underlying implementation
 * (native IPC, fetch API, axios, etc.) without changing
 * the code that uses it.
 */
export interface FetchFeedResult {
  notModified: boolean;
  data?: string;
  etag?: string;
  lastModified?: string;
}

export interface IHttpClient {
  /**
   * Fetch content from a URL
   * @param url The URL to fetch from
   * @param options Optional request options
   * @returns Promise that resolves to the response text
   * @throws Error if the request fails
   */
  get(url: string, options?: HttpRequestOptions): Promise<string>;

  /**
   * Fetch content with conditional GET support
   * @param url The URL to fetch from
   * @param options Optional request options including etag and lastModified
   */
  getWithCache?(url: string, options?: HttpRequestOptions): Promise<FetchFeedResult>;
}

/**
 * HTTP Request Options
 */
export interface HttpRequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
  etag?: string;
  lastModified?: string;
  signal?: AbortSignal;
}
