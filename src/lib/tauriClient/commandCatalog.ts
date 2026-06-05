export type TauriCommandDomain =
  | "articles"
  | "diagnostics"
  | "feeds"
  | "saved"
  | "settings"
  | "shell"
  | "system"
  | "tasks";

export type TauriCommandKind = "invoke" | "event";

export interface TauriCommandCatalogEntry {
  legacyMethod: string;
  legacyChannel: string;
  kind: TauriCommandKind;
  targetCommand: string;
  notes?: string;
}

export const tauriCommandCatalog: Record<
  TauriCommandDomain,
  readonly TauriCommandCatalogEntry[]
> = {
  shell: [
    { legacyMethod: "windowMinimize", legacyChannel: "window-minimize", kind: "invoke", targetCommand: "shell.window.minimize" },
    { legacyMethod: "windowMaximize", legacyChannel: "window-maximize", kind: "invoke", targetCommand: "shell.window.maximize" },
    { legacyMethod: "windowClose", legacyChannel: "window-close", kind: "invoke", targetCommand: "shell.window.close" },
    { legacyMethod: "hideTrafficLights", legacyChannel: "hide-traffic-lights", kind: "invoke", targetCommand: "shell.window.hideTrafficLights" },
    { legacyMethod: "showTrafficLights", legacyChannel: "show-traffic-lights", kind: "invoke", targetCommand: "shell.window.showTrafficLights" },
    { legacyMethod: "openSettings", legacyChannel: "open-settings", kind: "invoke", targetCommand: "shell.window.openSettings" },
    { legacyMethod: "updateAppMenuState", legacyChannel: "app-menu:update-state", kind: "invoke", targetCommand: "shell.menu.updateState" },
    { legacyMethod: "onAppMenuCommand", legacyChannel: "app-menu:command", kind: "event", targetCommand: "shell.menu.onCommand" },
    { legacyMethod: "openExternal", legacyChannel: "open-external", kind: "invoke", targetCommand: "shell.links.openExternal" },
    { legacyMethod: "openArticleWindow", legacyChannel: "open-article-window", kind: "invoke", targetCommand: "shell.articleWindow.open" },
    { legacyMethod: "getArticleWindowData", legacyChannel: "get-article-window-data", kind: "invoke", targetCommand: "shell.articleWindow.getData" },
    { legacyMethod: "showShareSheet", legacyChannel: "show-share-sheet", kind: "invoke", targetCommand: "shell.share.openSheet" },
    { legacyMethod: "showImageContextMenu", legacyChannel: "show-image-context-menu", kind: "invoke", targetCommand: "shell.contextMenu.showImage" },
    { legacyMethod: "getShareServices", legacyChannel: "get-share-services", kind: "invoke", targetCommand: "shell.share.listServices" },
    { legacyMethod: "shareToService", legacyChannel: "share-to-service", kind: "invoke", targetCommand: "shell.share.sendToService" },
  ],
  feeds: [
    { legacyMethod: "fetchFeed", legacyChannel: "fetch-feed", kind: "invoke", targetCommand: "feeds.fetch" },
    { legacyMethod: "fetchFeedWithCache", legacyChannel: "fetch-feed-with-cache", kind: "invoke", targetCommand: "feeds.fetchWithCache" },
    { legacyMethod: "abortFeedRequest", legacyChannel: "abort-feed-request", kind: "invoke", targetCommand: "feeds.abortRequest" },
    { legacyMethod: "fetchFavicon", legacyChannel: "fetch-favicon", kind: "invoke", targetCommand: "feeds.fetchFavicon" },
    { legacyMethod: "fetchEnhancedFavicon", legacyChannel: "fetch-enhanced-favicon", kind: "invoke", targetCommand: "feeds.fetchEnhancedFavicon" },
    { legacyMethod: "openOpmlFile", legacyChannel: "opml-open-file", kind: "invoke", targetCommand: "feeds.imports.openOpml" },
    { legacyMethod: "saveOpmlFile", legacyChannel: "opml-save-file", kind: "invoke", targetCommand: "feeds.imports.saveOpml" },
    { legacyMethod: "dbFeedsGetAll", legacyChannel: "db-feeds-get-all", kind: "invoke", targetCommand: "feeds.list" },
    { legacyMethod: "dbFeedsGet", legacyChannel: "db-feeds-get", kind: "invoke", targetCommand: "feeds.get" },
    { legacyMethod: "dbFeedsGetByUrl", legacyChannel: "db-feeds-get-by-url", kind: "invoke", targetCommand: "feeds.getByUrl" },
    { legacyMethod: "dbFeedsInsert", legacyChannel: "db-feeds-insert", kind: "invoke", targetCommand: "feeds.create" },
    { legacyMethod: "dbFeedsUpdate", legacyChannel: "db-feeds-update", kind: "invoke", targetCommand: "feeds.update" },
    { legacyMethod: "dbFeedsDelete", legacyChannel: "db-feeds-delete", kind: "invoke", targetCommand: "feeds.delete" },
    { legacyMethod: "dbFeedsUpdateUnread", legacyChannel: "db-feeds-update-unread", kind: "invoke", targetCommand: "feeds.updateUnreadCount" },
    { legacyMethod: "dbFeedsUpdateArticleCount", legacyChannel: "db-feeds-update-article-count", kind: "invoke", targetCommand: "feeds.updateArticleCount" },
    { legacyMethod: "dbFeedsUpdateLastFetched", legacyChannel: "db-feeds-update-last-fetched", kind: "invoke", targetCommand: "feeds.updateLastFetched" },
    { legacyMethod: "dbFeedsCount", legacyChannel: "db-feeds-count", kind: "invoke", targetCommand: "feeds.count" },
    { legacyMethod: "dbTagsGetAll", legacyChannel: "db-tags-get-all", kind: "invoke", targetCommand: "feeds.tags.list" },
    { legacyMethod: "dbTagsGetWithFeedIds", legacyChannel: "db-tags-get-with-feed-ids", kind: "invoke", targetCommand: "feeds.tags.listWithFeedIds" },
    { legacyMethod: "dbTagsUpsert", legacyChannel: "db-tags-upsert", kind: "invoke", targetCommand: "feeds.tags.upsert" },
    { legacyMethod: "dbTagsUpdate", legacyChannel: "db-tags-update", kind: "invoke", targetCommand: "feeds.tags.update" },
    { legacyMethod: "dbTagsRename", legacyChannel: "db-tags-rename", kind: "invoke", targetCommand: "feeds.tags.rename" },
    { legacyMethod: "dbTagsDelete", legacyChannel: "db-tags-delete", kind: "invoke", targetCommand: "feeds.tags.delete" },
    { legacyMethod: "dbTagsAddFeed", legacyChannel: "db-tags-add-feed", kind: "invoke", targetCommand: "feeds.tags.attachFeed" },
    { legacyMethod: "dbTagsRemoveFeed", legacyChannel: "db-tags-remove-feed", kind: "invoke", targetCommand: "feeds.tags.detachFeed" },
    { legacyMethod: "dbTagsGetFeedIds", legacyChannel: "db-tags-get-feed-ids", kind: "invoke", targetCommand: "feeds.tags.listFeedIds" },
    { legacyMethod: "dbTagsGetByFeed", legacyChannel: "db-tags-get-by-feed", kind: "invoke", targetCommand: "feeds.tags.listByFeed" },
  ],
  articles: [
    { legacyMethod: "parseArticle", legacyChannel: "parse-article", kind: "invoke", targetCommand: "articles.parse" },
    { legacyMethod: "fetchHtmlSafe", legacyChannel: "fetch-html-safe", kind: "invoke", targetCommand: "articles.fetchHtmlSafe" },
    { legacyMethod: "dbArticlesQuery", legacyChannel: "db-articles-query", kind: "invoke", targetCommand: "articles.query" },
    { legacyMethod: "dbArticlesGet", legacyChannel: "db-articles-get", kind: "invoke", targetCommand: "articles.get" },
    { legacyMethod: "dbArticlesGetContent", legacyChannel: "db-articles-get-content", kind: "invoke", targetCommand: "articles.getContent" },
    { legacyMethod: "dbArticlesExists", legacyChannel: "db-articles-exists", kind: "invoke", targetCommand: "articles.exists" },
    { legacyMethod: "dbArticlesInsertBatch", legacyChannel: "db-articles-insert-batch", kind: "invoke", targetCommand: "articles.insertBatch" },
    { legacyMethod: "dbArticlesUpdateRead", legacyChannel: "db-articles-update-read", kind: "invoke", targetCommand: "articles.updateRead" },
    { legacyMethod: "dbArticlesUpdateLastReadAt", legacyChannel: "db-articles-update-last-read-at", kind: "invoke", targetCommand: "articles.updateLastReadAt" },
    { legacyMethod: "dbArticlesToggleStarred", legacyChannel: "db-articles-toggle-starred", kind: "invoke", targetCommand: "articles.toggleStarred" },
    { legacyMethod: "dbArticlesUpdateSaved", legacyChannel: "db-articles-update-saved", kind: "invoke", targetCommand: "articles.updateSavedState" },
    { legacyMethod: "dbArticlesDeleteByFeed", legacyChannel: "db-articles-delete-by-feed", kind: "invoke", targetCommand: "articles.deleteByFeed" },
    { legacyMethod: "dbArticlesCleanOld", legacyChannel: "db-articles-clean-old", kind: "invoke", targetCommand: "articles.cleanOldByFeed" },
    { legacyMethod: "dbArticlesCleanOldAcrossFeeds", legacyChannel: "db-articles-clean-old-across-feeds", kind: "invoke", targetCommand: "articles.cleanOldAcrossFeeds" },
    { legacyMethod: "dbArticlesUnreadCount", legacyChannel: "db-articles-unread-count", kind: "invoke", targetCommand: "articles.countUnreadByFeed" },
    { legacyMethod: "dbArticlesCount", legacyChannel: "db-articles-count", kind: "invoke", targetCommand: "articles.countByFeed" },
    { legacyMethod: "dbArticlesUpdateFeedMeta", legacyChannel: "db-articles-update-feed-meta", kind: "invoke", targetCommand: "articles.updateFeedMeta" },
  ],
  saved: [
    { legacyMethod: "pickSavedArticlesSyncFolder", legacyChannel: "saved-articles-sync-pick-folder", kind: "invoke", targetCommand: "saved.sync.pickFolder" },
    { legacyMethod: "queueSavedArticlesFolderSync", legacyChannel: "saved-articles-sync-queue", kind: "invoke", targetCommand: "saved.sync.queue" },
    { legacyMethod: "pickSavedArticlesExportPath", legacyChannel: "saved-articles-export-pick-path", kind: "invoke", targetCommand: "saved.export.pickPath" },
    { legacyMethod: "getSavedArticlesExportPreflight", legacyChannel: "saved-articles-export-preflight", kind: "invoke", targetCommand: "saved.export.preflight" },
    { legacyMethod: "startSavedArticlesExport", legacyChannel: "saved-articles-export-start", kind: "invoke", targetCommand: "saved.export.start" },
    { legacyMethod: "onSavedArticlesExportEvent", legacyChannel: "saved-articles-export:event", kind: "event", targetCommand: "saved.export.onProgress" },
    { legacyMethod: "dbSavedInsert", legacyChannel: "db-saved-insert", kind: "invoke", targetCommand: "saved.create" },
    { legacyMethod: "dbSavedInsertBatch", legacyChannel: "db-saved-insert-batch", kind: "invoke", targetCommand: "saved.insertBatch" },
    { legacyMethod: "dbSavedDelete", legacyChannel: "db-saved-delete", kind: "invoke", targetCommand: "saved.delete" },
    { legacyMethod: "dbSavedGet", legacyChannel: "db-saved-get", kind: "invoke", targetCommand: "saved.get" },
    { legacyMethod: "dbSavedGetByHash", legacyChannel: "db-saved-get-by-hash", kind: "invoke", targetCommand: "saved.getByArticleHash" },
    { legacyMethod: "dbSavedGetByLink", legacyChannel: "db-saved-get-by-link", kind: "invoke", targetCommand: "saved.getByLink" },
    { legacyMethod: "dbSavedGetAll", legacyChannel: "db-saved-get-all", kind: "invoke", targetCommand: "saved.listAll" },
    { legacyMethod: "dbSavedQuery", legacyChannel: "db-saved-query", kind: "invoke", targetCommand: "saved.query" },
    { legacyMethod: "dbSavedGetContent", legacyChannel: "db-saved-get-content", kind: "invoke", targetCommand: "saved.getContent" },
    { legacyMethod: "dbSavedUpdateHighlights", legacyChannel: "db-saved-update-highlights", kind: "invoke", targetCommand: "saved.updateHighlights" },
    { legacyMethod: "dbSavedUpdateNotes", legacyChannel: "db-saved-update-notes", kind: "invoke", targetCommand: "saved.updateNotes" },
    { legacyMethod: "dbSavedUpdateLastReadAt", legacyChannel: "db-saved-update-last-read-at", kind: "invoke", targetCommand: "saved.updateLastReadAt" },
  ],
  settings: [
    { legacyMethod: "storageGet", legacyChannel: "storage-get", kind: "invoke", targetCommand: "settings.get", notes: "The Tauri app returns a normalized settings document instead of arbitrary key lookups." },
    { legacyMethod: "storageSet", legacyChannel: "storage-set", kind: "invoke", targetCommand: "settings.update", notes: "The Tauri app applies structured settings patches instead of per-key string writes." },
    { legacyMethod: "storageRemove", legacyChannel: "storage-remove", kind: "invoke", targetCommand: "settings.update", notes: "Nullable fields clear values through the same structured patch command." },
    { legacyMethod: "storageClear", legacyChannel: "storage-clear", kind: "invoke", targetCommand: "settings.reset" },
    { legacyMethod: "storageGetAllKeys", legacyChannel: "storage-get-all-keys", kind: "invoke", targetCommand: "settings.get", notes: "Migration work now treats settings as one document, so enumeration is replaced by full-snapshot reads." },
    { legacyMethod: "notifySettingsChanged", legacyChannel: "notify-settings-changed", kind: "invoke", targetCommand: "settings.update", notes: "An explicit settings-changed event can be layered on top of the document store after more domains migrate." },
    { legacyMethod: "onSettingsChanged", legacyChannel: "settings-changed", kind: "event", targetCommand: "settings.onChanged" },
  ],
  system: [
    { legacyMethod: "getSystemAppIconState", legacyChannel: "system-app-icon:get-state", kind: "invoke", targetCommand: "system.appIcon.getState" },
    { legacyMethod: "setSystemAppIconVariant", legacyChannel: "system-app-icon:set-variant", kind: "invoke", targetCommand: "system.appIcon.setVariant" },
    { legacyMethod: "pickSystemAppIcon", legacyChannel: "system-app-icon:pick", kind: "invoke", targetCommand: "system.appIcon.pick" },
    { legacyMethod: "resetSystemAppIcon", legacyChannel: "system-app-icon:reset", kind: "invoke", targetCommand: "system.appIcon.reset" },
    { legacyMethod: "relaunchApplication", legacyChannel: "app-relaunch", kind: "invoke", targetCommand: "system.app.relaunch" },
    { legacyMethod: "getSystemAccentColor", legacyChannel: "get-system-accent-color", kind: "invoke", targetCommand: "system.theme.getAccentColor" },
    { legacyMethod: "onSystemAccentColorChanged", legacyChannel: "system-accent-color-changed", kind: "event", targetCommand: "system.theme.onAccentColorChanged" },
    { legacyMethod: "readClipboard", legacyChannel: "read-clipboard", kind: "invoke", targetCommand: "system.clipboard.readText" },
    { legacyMethod: "writeClipboard", legacyChannel: "write-clipboard", kind: "invoke", targetCommand: "system.clipboard.writeText" },
  ],
  diagnostics: [
    { legacyMethod: "logEntry", legacyChannel: "log-entry", kind: "invoke", targetCommand: "diagnostics.log.writeEntry" },
    { legacyMethod: "getLogsPath", legacyChannel: "get-logs-path", kind: "invoke", targetCommand: "diagnostics.log.getPath" },
    { legacyMethod: "perfSnapshot", legacyChannel: "perf-snapshot", kind: "invoke", targetCommand: "diagnostics.performance.snapshot" },
    { legacyMethod: "exportDiagnostics", legacyChannel: "export-diagnostics", kind: "invoke", targetCommand: "diagnostics.exportBundle" },
  ],
  tasks: [
    { legacyMethod: "helperTaskAdd", legacyChannel: "helper-task:add", kind: "invoke", targetCommand: "tasks.helper.add" },
    { legacyMethod: "helperTaskRemove", legacyChannel: "helper-task:remove", kind: "invoke", targetCommand: "tasks.helper.remove" },
    { legacyMethod: "helperTaskClear", legacyChannel: "helper-task:clear", kind: "invoke", targetCommand: "tasks.helper.clear" },
    { legacyMethod: "helperTaskGetQueueSnapshot", legacyChannel: "helper-task:queue-snapshot", kind: "invoke", targetCommand: "tasks.helper.getQueueSnapshot" },
    { legacyMethod: "onHelperTaskResult", legacyChannel: "helper-task:result", kind: "event", targetCommand: "tasks.helper.onResult" },
  ],
};
