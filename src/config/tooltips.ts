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
    editFeeds: 'Manage feeds',
    themeAuto: 'Theme: Auto (follow system)',
    themeLight: 'Theme: Light',
    themeDark: 'Theme: Dark',
  },

  // Article List buttons
  articleList: {
    search: 'Search articles',
    searchDisabled: 'Add feeds to search',
    markRead: 'Mark as read',
  },

} as const;
