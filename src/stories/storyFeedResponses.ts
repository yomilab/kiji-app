/**
 * Canned network answers for Storybook: the mocked feed fetcher
 * (`.storybook/mocks/dataServices.ts`) serves these by URL so stories can
 * show lookup states such as the Add Feeds pick list.
 */
const responses = new Map<string, string>();

export const setStoryFeedResponses = (next: Record<string, string>): void => {
  responses.clear();
  for (const [url, body] of Object.entries(next)) {
    responses.set(url, body);
  }
};

export const getStoryFeedResponse = (url: string): string | undefined => responses.get(url);
