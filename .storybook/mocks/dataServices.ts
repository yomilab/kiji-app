import type { Article } from '../../src/types/article';
import {
  getThemeDebugFeeds,
  getThemeDebugTags,
} from '../../src/stories/themeDebugRuntime';

const asyncNoop = async (): Promise<void> => {};
const noop = (): void => {};

export const DEFAULT_SETTINGS = {
  theme: 'light',
  layout: '2-column',
  sidebarWidth: 300,
  articleListWidth: 420,
  sidebarLibrary: { title: 'Library', visible: true },
  sidebarSectionFold: { libraryExpanded: true, stationsExpanded: true },
  smartViews: [
    { id: 'saved', visible: true, sortOrder: 0 },
    { id: 'unread', visible: true, sortOrder: 1 },
    { id: 'all', visible: true, sortOrder: 2 },
    { id: 'read', visible: true, sortOrder: 3 },
  ],
};

export const UI_THEME_VARIANT_OPTIONS = [
  { value: 'modern', label: 'Modern' },
  { value: 'classic', label: 'Classic' },
];

export const settingsManager = {
  getSidebarWidth: async () => 300,
  getArticleListWidth: async () => 420,
  getSidebarLibrary: async () => ({ title: 'Library', visible: true }),
  getSidebarSectionFold: async () => ({ libraryExpanded: true, stationsExpanded: true }),
  getSmartViews: async () => DEFAULT_SETTINGS.smartViews,
  getSettings: async () => DEFAULT_SETTINGS,
  setSidebarWidth: asyncNoop,
  setArticleListWidth: asyncNoop,
  setSidebarSectionFold: asyncNoop,
  setSurfaceFillOpacityNow: noop,
};

export const storage = {
  get: async (key: string) => key === 'smart-views-emojis'
    ? JSON.stringify({ saved: '📥', unread: '●', all: '◉', read: '✓' })
    : null,
  set: asyncNoop,
  remove: asyncNoop,
};

export async function getAllFeedMetadataCached() {
  return getThemeDebugFeeds();
}

export const tagsManager = {
  getAllTags: async () => getThemeDebugTags(),
  getTagsForFeed: async () => [],
  addTagToFeed: asyncNoop,
  removeTagFromFeed: asyncNoop,
};

export const feedsManager = {
  getAllFeeds: async () => getThemeDebugFeeds(),
  getFeedById: async (feedId: string) => getThemeDebugFeeds().find((feed) => feed.id === feedId) ?? null,
  getFeedByUrl: async (feedUrl: string) => getThemeDebugFeeds().find((feed) => feed.url === feedUrl) ?? null,
  addFeed: async () => getThemeDebugFeeds()[0],
  updateFeed: async (feedId: string) => getThemeDebugFeeds().find((feed) => feed.id === feedId) ?? null,
  deleteFeed: async () => true,
  deleteFeeds: async () => true,
  generateId: () => 'theme-debug-feed',
};

export const feedsFetcher = {
  fetchFeedWithCache: async () => ({
    title: 'Storybook feed',
    items: [],
    notModified: false,
  }),
};

export function parseFeed() {
  return [];
}

export function parseFeedWithDiagnostics() {
  return {
    items: [],
    diagnostics: {
      feedUrl: 'https://example.com/theme-debug.xml',
      rawBytes: 0,
      rawChars: 0,
      parserPath: 'storybook',
      itemCount: 0,
    },
  };
}

export const storeParsedFeedContent = async () => ({
  feedId: 'theme-debug-feed',
  insertedCount: 0,
});

export const hydrateLibraryAfterImport = asyncNoop;

export async function getSavedContent(): Promise<string | null> {
  return null;
}

export async function getContent(): Promise<string | null> {
  return null;
}

export async function getByHash(): Promise<Article | null> {
  return null;
}

export async function syncFeedCountsBatch() {
  return [];
}

export const articlesManager = {
  deleteArticlesByFeed: asyncNoop,
  updateSavedStatus: asyncNoop,
  updateLastReadAt: asyncNoop,
  updateReadStatus: asyncNoop,
};

export const articleContentProcessingService = {
  clearCache: noop,
  startPreprocessTask: async ({ html }: { html: string }) => ({
    taskId: 'theme-debug-preprocess',
    promise: Promise.resolve({ html }),
    cancel: asyncNoop,
  }),
};

export const savedArticlesService = {
  findSavedArticle: async () => null,
  saveArticle: async () => ({ id: 'theme-debug-saved' }),
  unsaveArticle: asyncNoop,
  updateLastReadAt: asyncNoop,
};

export const readerModeService = {
  fetchAndParse: async () => ({
    success: false,
    resourceType: 'html' as const,
    error: 'Reader-mode fetching is disabled in Storybook.',
  }),
};

export const postlightParserService = {
  parseUrl: async () => ({
    success: false,
    error: 'URL parsing is disabled in Storybook.',
  }),
};

export const faviconFetcher = {
  fetchFavicon: async () => null,
};

export const logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  setPersistToFile: noop,
};

export const appToastService = {
  show: noop,
  clear: noop,
};

export const feedLibraryMutationBus = {
  isUnstationedHydrateFresh: () => false,
  isStationsHydrateFresh: () => false,
  publishFeedDeleted: noop,
  publishFeedsAdded: noop,
  publishFeedPatched: noop,
  publishStationPatched: noop,
};

export const opmlWorkflowService = {
  scheduleMissingFaviconsAfterStationSelection: noop,
};

export const fetchOpmlTextFromUrl = async () => null;
export const formatOpmlImportSummary = () => 'OPML import is disabled in Storybook.';
export const importOpmlFromUrlIntoLibrary = async () => null;
export const importOpmlTextIntoLibrary = async () => null;
export const isLikelyOpmlUrl = () => false;
export const navigateAfterOpmlImport = asyncNoop;
export const openOpmlFileForImport = async () => null;

export const persistUnstationedOrder = asyncNoop;
export const appendPromotedFeedsToUnstationed = asyncNoop;
export const persistNestedMembershipOrder = asyncNoop;
export const persistStationOrder = asyncNoop;
export const persistSmartViewOrder = asyncNoop;
export const persistSmartViewSettings = asyncNoop;

export const openSettingsWindow = asyncNoop;

export function estimateUtf8Bytes(value: string): number {
  return value.length;
}

export const shouldLogDetailedAttribution = () => false;
export const logFeedNetworkAttribution = noop;
export const logFeedParseAttribution = noop;
export const logReaderDomAttribution = noop;
export const logArticleRenderAttribution = noop;
export const logNativeFeedRefreshAttribution = noop;
export const logNativeFeedRefreshCycleAttribution = noop;
export const logRendererSessionMemoryAttribution = noop;
export const logListRefreshAttribution = noop;
export const logArticleOpenAttribution = noop;

