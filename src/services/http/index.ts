/**
 * HTTP Client Service
 * 
 * This module provides an abstraction layer for HTTP requests,
 * allowing you to swap the underlying implementation without
 * changing the code that uses it.
 * 
 * Usage:
 * ```typescript
 * import { httpClient } from './services/http';
 * 
 * const content = await httpClient.get('https://example.com/feed.xml');
 * ```
 * 
 * The Tauri renderer uses browser-safe HTTP clients; native feed fetching is
 * exposed through the Tauri feed service facade.
 * 
 * To use a custom implementation:
 * ```typescript
 * import { HttpClientFactory } from './services/http';
 * import { MyCustomHttpClient } from './my-custom-client';
 * 
 * HttpClientFactory.setClient(new MyCustomHttpClient());
 * ```
 */

export type { IHttpClient, HttpRequestOptions } from './httpClient';
export { BrowserHttpClient } from './browserHttpClient';
export { httpClient, HttpClientFactory } from './httpClientFactory';

