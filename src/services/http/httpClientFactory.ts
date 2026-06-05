import { IHttpClient } from './httpClient';
import { BrowserHttpClient } from './browserHttpClient';

/**
 * HTTP Client Factory
 * 
 * Factory that provides the appropriate HTTP client implementation
 * based on the runtime environment.
 */
class HttpClientFactory {
  private static instance: IHttpClient | null = null;

  /**
   * Get the HTTP client instance
   * 
   * Automatically detects the environment and returns:
   * - ElectronHttpClient if running in Electron
   * - BrowserHttpClient otherwise
   */
  static getClient(): IHttpClient {
    if (this.instance) {
      return this.instance;
    }

    this.instance = new BrowserHttpClient();

    return this.instance;
  }

  /**
   * Set a custom HTTP client implementation
   * 
   * Useful for testing or custom implementations
   */
  static setClient(client: IHttpClient): void {
    this.instance = client;
  }

  /**
   * Reset the client instance
   * 
   * Useful for testing or switching implementations at runtime
   */
  static reset(): void {
    this.instance = null;
  }
}

export const httpClient = HttpClientFactory.getClient();
export { HttpClientFactory };

