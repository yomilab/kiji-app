export type TauriCommandDomain =
  | "articles"
  | "diagnostics"
  | "feeds"
  | "saved"
  | "scheduler"
  | "settings"
  | "shell"
  | "system"
  | "tasks";

export type TauriCommandKind = "invoke" | "event" | "renderer";

export interface TauriCommandCatalogEntry {
  apiMethod: string;
  ipcChannel: string;
  kind: TauriCommandKind;
  /** Renderer API method name on window.kijiAPI. */
  targetCommand: string;
  /** Registered `generate_handler!` command when `kind` is `invoke`. */
  rustCommand?: string;
  notes?: string;
}

export const tauriCommandCatalog: Record<
  TauriCommandDomain,
  readonly TauriCommandCatalogEntry[]
> = {
  shell: [
    { apiMethod: "hideTrafficLights", ipcChannel: "hide-traffic-lights", kind: "renderer", targetCommand: "shell.window.hideTrafficLights" },
    { apiMethod: "showTrafficLights", ipcChannel: "show-traffic-lights", kind: "renderer", targetCommand: "shell.window.showTrafficLights" },
    { apiMethod: "openSettings", ipcChannel: "open-settings", kind: "invoke", targetCommand: "shell.window.openSettings", rustCommand: "shell_settings_window_open" },
    { apiMethod: "confirmDialog", ipcChannel: "dialog-confirm", kind: "invoke", targetCommand: "shell.dialog.confirm", rustCommand: "shell_dialog_confirm" },
    { apiMethod: "updateAppMenuState", ipcChannel: "app-menu:update-state", kind: "invoke", targetCommand: "shell.menu.updateState", rustCommand: "shell_menu_update_state" },
    { apiMethod: "onAppMenuCommand", ipcChannel: "app-menu:command", kind: "event", targetCommand: "shell.menu.onCommand" },
    { apiMethod: "openExternal", ipcChannel: "open-external", kind: "invoke", targetCommand: "shell.links.openExternal", rustCommand: "shell_links_open_external" },
    { apiMethod: "openArticleWindow", ipcChannel: "open-article-window", kind: "invoke", targetCommand: "shell.articleWindow.open", rustCommand: "shell_article_window_open" },
    { apiMethod: "getArticleWindowData", ipcChannel: "get-article-window-data", kind: "invoke", targetCommand: "shell.articleWindow.getData", rustCommand: "shell_article_window_get_data" },
    { apiMethod: "openUpdateWindow", ipcChannel: "open-update-window", kind: "invoke", targetCommand: "shell.updateWindow.open", rustCommand: "shell_update_window_open" },
    { apiMethod: "getUpdateWindowData", ipcChannel: "get-update-window-data", kind: "invoke", targetCommand: "shell.updateWindow.getData", rustCommand: "shell_update_window_get_data" },
    { apiMethod: "showShareSheet", ipcChannel: "show-share-sheet", kind: "invoke", targetCommand: "shell.share.openSheet", rustCommand: "shell_share" },
    { apiMethod: "showImageContextMenu", ipcChannel: "show-image-context-menu", kind: "invoke", targetCommand: "shell.contextMenu.showImage", rustCommand: "shell_context_menu_show_image" },
    { apiMethod: "getShareServices", ipcChannel: "get-share-services", kind: "invoke", targetCommand: "shell.share.listServices", rustCommand: "shell_share_list_services" },
    { apiMethod: "shareToService", ipcChannel: "share-to-service", kind: "invoke", targetCommand: "shell.share.sendToService", rustCommand: "shell_share_to_service" },
  ],
  feeds: [
    { apiMethod: "fetchFeed", ipcChannel: "fetch-feed", kind: "invoke", targetCommand: "feeds.fetch", rustCommand: "feeds_fetch" },
    { apiMethod: "fetchFeedWithCache", ipcChannel: "fetch-feed-with-cache", kind: "invoke", targetCommand: "feeds.fetchWithCache", rustCommand: "feeds_fetch_with_cache" },
    { apiMethod: "abortFeedRequest", ipcChannel: "abort-feed-request", kind: "invoke", targetCommand: "feeds.abortRequest", rustCommand: "feeds_abort_request" },
    { apiMethod: "fetchFavicon", ipcChannel: "fetch-favicon", kind: "invoke", targetCommand: "feeds.fetchFavicon", rustCommand: "feeds_fetch_data_url" },
    { apiMethod: "fetchEnhancedFavicon", ipcChannel: "fetch-enhanced-favicon", kind: "invoke", targetCommand: "feeds.fetchEnhancedFavicon", rustCommand: "feeds_fetch_data_url" },
    { apiMethod: "openOpmlFile", ipcChannel: "opml-open-file", kind: "invoke", targetCommand: "feeds.imports.openOpml", rustCommand: "shell_dialog_open_file" },
    { apiMethod: "saveOpmlFile", ipcChannel: "opml-save-file", kind: "invoke", targetCommand: "feeds.imports.saveOpml", rustCommand: "shell_dialog_save_file" },
    { apiMethod: "dbFeedsGetAll", ipcChannel: "db-feeds-get-all", kind: "invoke", targetCommand: "feeds.list", rustCommand: "feeds_list" },
    { apiMethod: "dbFeedsGet", ipcChannel: "db-feeds-get", kind: "invoke", targetCommand: "feeds.get", rustCommand: "feeds_get" },
    { apiMethod: "dbFeedsGetByUrl", ipcChannel: "db-feeds-get-by-url", kind: "invoke", targetCommand: "feeds.getByUrl", rustCommand: "feeds_get_by_url" },
    { apiMethod: "dbFeedsInsert", ipcChannel: "db-feeds-insert", kind: "invoke", targetCommand: "feeds.create", rustCommand: "feeds_create" },
    { apiMethod: "dbFeedsUpdate", ipcChannel: "db-feeds-update", kind: "invoke", targetCommand: "feeds.update", rustCommand: "feeds_update" },
    { apiMethod: "dbFeedsDelete", ipcChannel: "db-feeds-delete", kind: "invoke", targetCommand: "feeds.delete", rustCommand: "feeds_delete" },
    { apiMethod: "dbFeedsDeleteMany", ipcChannel: "db-feeds-delete-many", kind: "invoke", targetCommand: "feeds.deleteMany", rustCommand: "feeds_delete_many" },
    { apiMethod: "dbFeedsUpdateUnread", ipcChannel: "db-feeds-update-unread", kind: "invoke", targetCommand: "feeds.updateUnreadCount", rustCommand: "feeds_update_unread_count" },
    { apiMethod: "dbFeedsUpdateArticleCount", ipcChannel: "db-feeds-update-article-count", kind: "invoke", targetCommand: "feeds.updateArticleCount", rustCommand: "feeds_update_article_count" },
    { apiMethod: "dbFeedsUpdateLastFetched", ipcChannel: "db-feeds-update-last-fetched", kind: "invoke", targetCommand: "feeds.updateLastFetched", rustCommand: "feeds_update_last_fetched" },
    { apiMethod: "dbFeedsCount", ipcChannel: "db-feeds-count", kind: "invoke", targetCommand: "feeds.count", rustCommand: "feeds_count" },
    { apiMethod: "dbTagsGetAll", ipcChannel: "db-tags-get-all", kind: "invoke", targetCommand: "feeds.tags.list", rustCommand: "feeds_tags_list" },
    { apiMethod: "dbTagsGetWithFeedIds", ipcChannel: "db-tags-get-with-feed-ids", kind: "invoke", targetCommand: "feeds.tags.listWithFeedIds", rustCommand: "feeds_tags_list_with_feed_ids" },
    { apiMethod: "dbTagsUpsert", ipcChannel: "db-tags-upsert", kind: "invoke", targetCommand: "feeds.tags.upsert", rustCommand: "feeds_tags_upsert" },
    { apiMethod: "dbTagsUpdate", ipcChannel: "db-tags-update", kind: "invoke", targetCommand: "feeds.tags.update", rustCommand: "feeds_tags_update" },
    { apiMethod: "dbTagsRename", ipcChannel: "db-tags-rename", kind: "invoke", targetCommand: "feeds.tags.rename", rustCommand: "feeds_tags_rename" },
    { apiMethod: "dbTagsDelete", ipcChannel: "db-tags-delete", kind: "invoke", targetCommand: "feeds.tags.delete", rustCommand: "feeds_tags_delete" },
    { apiMethod: "dbTagsAddFeed", ipcChannel: "db-tags-add-feed", kind: "invoke", targetCommand: "feeds.tags.attachFeed", rustCommand: "feeds_tags_attach_feed" },
    { apiMethod: "dbTagsRemoveFeed", ipcChannel: "db-tags-remove-feed", kind: "invoke", targetCommand: "feeds.tags.detachFeed", rustCommand: "feeds_tags_detach_feed" },
    { apiMethod: "dbTagsGetFeedIds", ipcChannel: "db-tags-get-feed-ids", kind: "invoke", targetCommand: "feeds.tags.listFeedIds", rustCommand: "feeds_tags_list_feed_ids" },
    { apiMethod: "dbTagsGetByFeed", ipcChannel: "db-tags-get-by-feed", kind: "invoke", targetCommand: "feeds.tags.listByFeed", rustCommand: "feeds_tags_list_by_feed" },
  ],
  articles: [
    { apiMethod: "parseArticle", ipcChannel: "parse-article", kind: "renderer", targetCommand: "articles.parse", notes: "Renderer composes feeds_fetch plus article extraction." },
    { apiMethod: "fetchHtmlSafe", ipcChannel: "fetch-html-safe", kind: "invoke", targetCommand: "articles.fetchHtmlSafe", rustCommand: "feeds_fetch_html_safe" },
    { apiMethod: "dbArticlesQuery", ipcChannel: "db-articles-query", kind: "invoke", targetCommand: "articles.query", rustCommand: "articles_query" },
    { apiMethod: "dbArticlesGet", ipcChannel: "db-articles-get", kind: "invoke", targetCommand: "articles.get", rustCommand: "articles_get" },
    { apiMethod: "dbArticlesGetContent", ipcChannel: "db-articles-get-content", kind: "invoke", targetCommand: "articles.getContent", rustCommand: "articles_get_content" },
    { apiMethod: "dbArticlesExists", ipcChannel: "db-articles-exists", kind: "invoke", targetCommand: "articles.exists", rustCommand: "articles_exists" },
    { apiMethod: "dbArticlesInsertBatch", ipcChannel: "db-articles-insert-batch", kind: "invoke", targetCommand: "articles.insertBatch", rustCommand: "articles_insert_batch" },
    { apiMethod: "dbArticlesUpdateRead", ipcChannel: "db-articles-update-read", kind: "invoke", targetCommand: "articles.updateRead", rustCommand: "articles_update_read" },
    { apiMethod: "dbArticlesUpdateLastReadAt", ipcChannel: "db-articles-update-last-read-at", kind: "invoke", targetCommand: "articles.updateLastReadAt", rustCommand: "articles_update_last_read_at" },
    { apiMethod: "dbArticlesToggleStarred", ipcChannel: "db-articles-toggle-starred", kind: "invoke", targetCommand: "articles.toggleStarred", rustCommand: "articles_toggle_starred" },
    { apiMethod: "dbArticlesUpdateSaved", ipcChannel: "db-articles-update-saved", kind: "invoke", targetCommand: "articles.updateSavedState", rustCommand: "articles_update_saved_state" },
    { apiMethod: "dbArticlesDeleteByFeed", ipcChannel: "db-articles-delete-by-feed", kind: "invoke", targetCommand: "articles.deleteByFeed", rustCommand: "articles_delete_by_feed" },
    { apiMethod: "dbArticlesCleanOld", ipcChannel: "db-articles-clean-old", kind: "invoke", targetCommand: "articles.cleanOldByFeed", rustCommand: "articles_clean_old_by_feed" },
    { apiMethod: "dbArticlesCleanOldAcrossFeeds", ipcChannel: "db-articles-clean-old-across-feeds", kind: "invoke", targetCommand: "articles.cleanOldAcrossFeeds", rustCommand: "articles_clean_old_across_feeds" },
    { apiMethod: "dbArticlesUnreadCount", ipcChannel: "db-articles-unread-count", kind: "invoke", targetCommand: "articles.countUnreadByFeed", rustCommand: "articles_count_unread_by_feed" },
    { apiMethod: "dbArticlesCount", ipcChannel: "db-articles-count", kind: "invoke", targetCommand: "articles.countByFeed", rustCommand: "articles_count_by_feed" },
    { apiMethod: "dbArticlesSyncFeedCountsBatch", ipcChannel: "db-articles-sync-feed-counts-batch", kind: "invoke", targetCommand: "articles.syncFeedCountsBatch", rustCommand: "articles_sync_feed_counts_batch" },
    { apiMethod: "dbArticlesUpdateFeedMeta", ipcChannel: "db-articles-update-feed-meta", kind: "invoke", targetCommand: "articles.updateFeedMeta", rustCommand: "articles_update_feed_meta" },
  ],
  saved: [
    { apiMethod: "pickSavedArticlesSyncFolder", ipcChannel: "saved-articles-sync-pick-folder", kind: "invoke", targetCommand: "saved.sync.pickFolder", rustCommand: "shell_dialog_pick_folder" },
    { apiMethod: "queueSavedArticlesFolderSync", ipcChannel: "saved-articles-sync-queue", kind: "invoke", targetCommand: "saved.sync.queue", rustCommand: "saved_sync_queue" },
    { apiMethod: "pickSavedArticlesExportPath", ipcChannel: "saved-articles-export-pick-path", kind: "invoke", targetCommand: "saved.export.pickPath", rustCommand: "shell_dialog_save_file" },
    { apiMethod: "getSavedArticlesExportPreflight", ipcChannel: "saved-articles-export-preflight", kind: "invoke", targetCommand: "saved.export.preflight", rustCommand: "saved_export_preflight" },
    { apiMethod: "startSavedArticlesExport", ipcChannel: "saved-articles-export-start", kind: "invoke", targetCommand: "saved.export.start", rustCommand: "saved_export_start" },
    { apiMethod: "onSavedArticlesExportEvent", ipcChannel: "saved-articles-export:event", kind: "event", targetCommand: "saved.export.onProgress" },
    { apiMethod: "dbSavedInsert", ipcChannel: "db-saved-insert", kind: "invoke", targetCommand: "saved.create", rustCommand: "saved_create" },
    { apiMethod: "dbSavedInsertBatch", ipcChannel: "db-saved-insert-batch", kind: "invoke", targetCommand: "saved.insertBatch", rustCommand: "saved_insert_batch" },
    { apiMethod: "dbSavedDelete", ipcChannel: "db-saved-delete", kind: "invoke", targetCommand: "saved.delete", rustCommand: "saved_delete" },
    { apiMethod: "dbSavedGet", ipcChannel: "db-saved-get", kind: "invoke", targetCommand: "saved.get", rustCommand: "saved_get" },
    { apiMethod: "dbSavedGetByHash", ipcChannel: "db-saved-get-by-hash", kind: "invoke", targetCommand: "saved.getByArticleHash", rustCommand: "saved_get_by_article_hash" },
    { apiMethod: "dbSavedGetByLink", ipcChannel: "db-saved-get-by-link", kind: "invoke", targetCommand: "saved.getByLink", rustCommand: "saved_get_by_link" },
    { apiMethod: "dbSavedGetAll", ipcChannel: "db-saved-get-all", kind: "invoke", targetCommand: "saved.listAll", rustCommand: "saved_list_all" },
    { apiMethod: "dbSavedQuery", ipcChannel: "db-saved-query", kind: "invoke", targetCommand: "saved.query", rustCommand: "saved_query" },
    { apiMethod: "dbSavedGetContent", ipcChannel: "db-saved-get-content", kind: "invoke", targetCommand: "saved.getContent", rustCommand: "saved_get_content" },
    { apiMethod: "dbSavedUpdateHighlights", ipcChannel: "db-saved-update-highlights", kind: "invoke", targetCommand: "saved.updateHighlights", rustCommand: "saved_update_highlights" },
    { apiMethod: "dbSavedUpdateNotes", ipcChannel: "db-saved-update-notes", kind: "invoke", targetCommand: "saved.updateNotes", rustCommand: "saved_update_notes" },
    { apiMethod: "dbSavedUpdateLastReadAt", ipcChannel: "db-saved-update-last-read-at", kind: "invoke", targetCommand: "saved.updateLastReadAt", rustCommand: "saved_update_last_read_at" },
  ],
  scheduler: [
    { apiMethod: "startFeedScheduler", ipcChannel: "scheduler-start", kind: "invoke", targetCommand: "scheduler.start", rustCommand: "scheduler_start" },
    { apiMethod: "stopFeedScheduler", ipcChannel: "scheduler-stop", kind: "invoke", targetCommand: "scheduler.stop", rustCommand: "scheduler_stop" },
    { apiMethod: "reconfigureFeedScheduler", ipcChannel: "scheduler-reconfigure", kind: "invoke", targetCommand: "scheduler.reconfigure", rustCommand: "scheduler_reconfigure" },
    { apiMethod: "onSchedulerCycleTick", ipcChannel: "scheduler:cycle-tick", kind: "event", targetCommand: "scheduler.onCycleTick" },
  ],
  settings: [
    { apiMethod: "storageGet", ipcChannel: "storage-get", kind: "invoke", targetCommand: "settings.get", rustCommand: "settings_get", notes: "The Tauri app returns a normalized settings document instead of arbitrary key lookups." },
    { apiMethod: "storageSet", ipcChannel: "storage-set", kind: "invoke", targetCommand: "settings.update", rustCommand: "settings_update", notes: "The Tauri app applies structured settings patches instead of per-key string writes." },
    { apiMethod: "storageRemove", ipcChannel: "storage-remove", kind: "invoke", targetCommand: "settings.update", rustCommand: "settings_update", notes: "Nullable fields clear values through the same structured patch command." },
    { apiMethod: "storageClear", ipcChannel: "storage-clear", kind: "invoke", targetCommand: "settings.reset", rustCommand: "settings_reset" },
    { apiMethod: "storageGetAllKeys", ipcChannel: "storage-get-all-keys", kind: "invoke", targetCommand: "settings.get", rustCommand: "settings_get", notes: "Migration work now treats settings as one document, so enumeration is replaced by full-snapshot reads." },
    { apiMethod: "notifySettingsChanged", ipcChannel: "notify-settings-changed", kind: "renderer", targetCommand: "settings.onChanged", notes: "Renderer emits settings-changed after native settings writes." },
    { apiMethod: "onSettingsChanged", ipcChannel: "settings-changed", kind: "event", targetCommand: "settings.onChanged" },
  ],
  system: [
    { apiMethod: "getSystemAppIconState", ipcChannel: "system-app-icon:get-state", kind: "invoke", targetCommand: "system.appIcon.getState", rustCommand: "system_app_icon_get_state" },
    { apiMethod: "setSystemAppIconVariant", ipcChannel: "system-app-icon:set-variant", kind: "invoke", targetCommand: "system.appIcon.setVariant", rustCommand: "system_app_icon_set_variant" },
    { apiMethod: "pickSystemAppIcon", ipcChannel: "system-app-icon:pick", kind: "invoke", targetCommand: "system.appIcon.pick", rustCommand: "system_app_icon_pick" },
    { apiMethod: "resetSystemAppIcon", ipcChannel: "system-app-icon:reset", kind: "invoke", targetCommand: "system.appIcon.reset", rustCommand: "system_app_icon_reset" },
    { apiMethod: "relaunchApplication", ipcChannel: "app-relaunch", kind: "invoke", targetCommand: "system.app.relaunch", rustCommand: "system_app_relaunch" },
    { apiMethod: "getSystemAccentColor", ipcChannel: "get-system-accent-color", kind: "invoke", targetCommand: "system.theme.getAccentColor", rustCommand: "system_theme_get_accent_color" },
    { apiMethod: "setSystemAppearance", ipcChannel: "system-appearance:set", kind: "invoke", targetCommand: "system.appearance.set", rustCommand: "system_appearance_set" },
    { apiMethod: "onSystemAccentColorChanged", ipcChannel: "system-accent-color-changed", kind: "event", targetCommand: "system.theme.onAccentColorChanged" },
    { apiMethod: "readClipboard", ipcChannel: "read-clipboard", kind: "invoke", targetCommand: "system.clipboard.readText", rustCommand: "system_clipboard_read_text" },
    { apiMethod: "writeClipboard", ipcChannel: "write-clipboard", kind: "invoke", targetCommand: "system.clipboard.writeText", rustCommand: "system_clipboard_write_text" },
  ],
  diagnostics: [
    { apiMethod: "logEntry", ipcChannel: "log-entry", kind: "invoke", targetCommand: "diagnostics.log.writeEntry", rustCommand: "diagnostics_log_write_entry" },
    { apiMethod: "getLogsPath", ipcChannel: "get-logs-path", kind: "invoke", targetCommand: "diagnostics.log.getPath", rustCommand: "diagnostics_log_get_path" },
    { apiMethod: "perfSnapshot", ipcChannel: "perf-snapshot", kind: "invoke", targetCommand: "diagnostics.performance.snapshot", rustCommand: "diagnostics_performance_snapshot" },
    { apiMethod: "exportDiagnostics", ipcChannel: "export-diagnostics", kind: "invoke", targetCommand: "diagnostics.exportBundle", rustCommand: "diagnostics_export_bundle" },
  ],
  tasks: [
    { apiMethod: "helperTaskAdd", ipcChannel: "helper-task:add", kind: "renderer", targetCommand: "tasks.helper.add", notes: "Renderer-side helper queue during migration; invoke allowlisted until Rust task handlers land." },
    { apiMethod: "helperTaskRemove", ipcChannel: "helper-task:remove", kind: "renderer", targetCommand: "tasks.helper.remove", notes: "Renderer-side helper queue during migration; invoke allowlisted until Rust task handlers land." },
    { apiMethod: "helperTaskClear", ipcChannel: "helper-task:clear", kind: "renderer", targetCommand: "tasks.helper.clear", notes: "Renderer-side helper queue during migration; invoke allowlisted until Rust task handlers land." },
    { apiMethod: "helperTaskGetQueueSnapshot", ipcChannel: "helper-task:queue-snapshot", kind: "renderer", targetCommand: "tasks.helper.getQueueSnapshot", notes: "Renderer-side helper queue during migration; invoke allowlisted until Rust task handlers land." },
    { apiMethod: "onHelperTaskResult", ipcChannel: "helper-task:result", kind: "event", targetCommand: "tasks.helper.onResult" },
  ],
};
