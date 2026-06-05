/**
 * Centralized tooltip text configuration for all buttons in the app
 */

export const TOOLTIPS = {
  // Article View buttons
  articleView: {
    back: 'Go back',
    titleOpenInBrowser: 'Open in browser',
    openNewWindow: 'Open in new window',
    saveArticle: 'Save article',
    unsaveArticle: 'Unsave article',
    readerModeEnable: 'Enable reader mode',
    readerModeDisable: 'Disable reader mode',
    shareArticle: 'Share article',
  },

  // Sidebar buttons
  sidebar: {
    refresh: 'Refresh current view',
    addFeed: 'Add new feed',
    settings: 'Settings',
    editFeeds: 'Edit feeds',
    themeAuto: 'Theme: Auto (follow system)',
    themeLight: 'Theme: Light',
    themeDark: 'Theme: Dark',
  },

  // Article List buttons
  articleList: {
    search: 'Search articles',
    searchDisabled: 'Add feeds to search',
  },

  feedEdit: {
    search: 'Search feeds',
    searchDisabled: 'Add feeds to search',
    exportAllFeeds: 'Export all feeds (OPML)',
    importFeeds: 'Import feeds (OPML)',
    moreActions: 'More feed actions',
    addStation: 'Add station',
  },
} as const;
