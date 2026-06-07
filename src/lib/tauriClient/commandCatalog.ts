export type TauriCommandDomain =
  | "articles"
  | "diagnostics"
  | "feeds"
  | "saved"
  | "settings"
  | "shell"
  | "system"
  | "tasks";

export type TauriCommandKind = "invoke" | "event" | "renderer";

export interface TauriCommandCatalogEntry {
  legacyMethod: string;
  legacyChannel: string;
  kind: TauriCommandKind;
  /** Logical grouped name for docs/migration references. */
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
    { legacyMethod: "hideTrafficLights", legacyChannel: "hide-traffic-lights", kind: "renderer", targetCommand: "shell.window.hideTrafficLights" },
    { legacyMethod: "showTrafficLights", legacyChannel: "show-traffic-lights", kind: "renderer", targetCommand: "shell.window.showTrafficLights" },
    { legacyMethod: "openSettings", legacyChannel: "open-settings", kind: "invoke", targetCommand: "shell.window.openSettings", rustCommand: "shell_settings_window_open" },
    { legacyMethod: "updateAppMenuState", legacyChannel: "app-menu:update-state", kind: "invoke", targetCommand: "shell.menu.updateState", rustCommand: "shell_menu_update_state" },
    { legacyMethod: "onAppMenuCommand", legacyChannel: "app-menu:command", kind: "event", targetCommand: "shell.menu.onCommand" },
    { legacyMethod: "openExternal", legacyChannel: "open-external", kind: "invoke", targetCommand: "shell.links.openExternal", rustCommand: "shell_links_open_external" },
    { legacyMethod: "openArticleWindow", legacyChannel: "open-article-window", kind: "invoke", targetCommand: "shell.articleWindow.open", rustCommand: "shell_article_window_open" },
    { legacyMethod: "getArticleWindowData", legacyChannel: "get-article-window-data", kind: "invoke", targetCommand: "shell.articleWindow.getData", rustCommand: "shell_article_window_get_data" },
    { legacyMethod: "showShareSheet", legacyChannel: "show-share-sheet", kind: "invoke", targetCommand: "shell.share.openSheet", rustCommand: "shell_share" },
    { legacyMethod: "showImageContextMenu", legacyChannel: "show-image-context-menu", kind: "invoke", targetCommand: "shell.contextMenu.showImage", rustCommand: "shell_context_menu_show_image" },
    { legacyMethod: "getShareServices", legacyChannel: "get-share-services", kind: "invoke", targetCommand: "shell.share.listServices", rustCommand: "shell_share_list_services" },
    { legacyMethod: "shareToService", legacyChannel: "share-to-service", kind: "invoke", targetCommand: "shell.share.sendToService", rustCommand: "shell_share_to_service" },
  ],
  feeds: [
    { legacyMethod: "fetchFeed", legacyChannel: "fetch-feed", kind: "invoke", targetCommand: "feeds.fetch", rustCommand: "feeds_fetch" },
    { legacyMethod: "fetchFeedWithCache", legacyChannel: "fetch-feed-with-cache", kind: "invoke", targetCommand: "feeds.fetchWithCache", rustCommand: "feeds_fetch_with_cache" },
    { legacyMethod: "abortFeedRequest", legacyChannel: "abort-feed-request", kind: "invoke", targetCommand: "feeds.abortRequest", rustCommand: "feeds_abort_request" },
    { legacyMethod: "fetchFavicon", legacyChannel: "fetch-favicon", kind: "invoke", targetCommand: "feeds.fetchFavicon", rustCommand: "feeds_fetch_data_url" },
    { legacyMethod: "fetchEnhancedFavicon", legacyChannel: "fetch-enhanced-favicon", kind: "invoke", targetCommand: "feeds.fetchEnhancedFavicon", rustCommand: "feeds_fetch_data_url" },
    { legacyMethod: "openOpmlFile", legacyChannel: "opml-open-file", kind: "invoke", targetCommand: "feeds.imports.openOpml", rustCommand: "shell_dialog_open_file" },
    { legacyMethod: "saveOpmlFile", legacyChannel: "opml-save-file", kind: "invoke", targetCommand: "feeds.imports.saveOpml", rustCommand: "shell_dialog_save_file" },
    { legacyMethod: "dbFeedsGetAll", legacyChannel: "db-feeds-get-all", kind: "invoke", targetCommand: "feeds.list", rustCommand: "feeds_list" },
    { legacyMethod: "dbFeedsGet", legacyChannel: "db-feeds-get", kind: "invoke", targetCommand: "feeds.get", rustCommand: "feeds_get" },
    { legacyMethod: "dbFeedsGetByUrl", legacyChannel: "db-feeds-get-by-url", kind: "invoke", targetCommand: "feeds.getByUrl", rustCommand: "feeds_get_by_url" },
    { legacyMethod: "dbFeedsInsert", legacyChannel: "db-feeds-insert", kind: "invoke", targetCommand: "feeds.create", rustCommand: "feeds_create" },
    { legacyMethod: "dbFeedsUpdate", legacyChannel: "db-feeds-update", kind: "invoke", targetCommand: "feeds.update", rustCommand: "feeds_update" },
    { legacyMethod: "dbFeedsDelete", legacyChannel: "db-feeds-delete", kind: "invoke", targetCommand: "feeds.delete", rustCommand: "feeds_delete" },
    { legacyMethod: "dbFeedsUpdateUnread", legacyChannel: "db-feeds-update-unread", kind: "invoke", targetCommand: "feeds.updateUnreadCount", rustCommand: "feeds_update_unread_count" },
    { legacyMethod: "dbFeedsUpdateArticleCount", legacyChannel: "db-feeds-update-article-count", kind: "invoke", targetCommand: "feeds.updateArticleCount", rustCommand: "feeds_update_article_count" },
    { legacyMethod: "dbFeedsUpdateLastFetched", legacyChannel: "db-feeds-update-last-fetched", kind: "invoke", targetCommand: "feeds.updateLastFetched", rustCommand: "feeds_update_last_fetched" },
    { legacyMethod: "dbFeedsCount", legacyChannel: "db-feeds-count", kind: "invoke", targetCommand: "feeds.count", rustCommand: "feeds_count" },
    { legacyMethod: "dbTagsGetAll", legacyChannel: "db-tags-get-all", kind: "invoke", targetCommand: "feeds.tags.list", rustCommand: "feeds_tags_list" },
    { legacyMethod: "dbTagsGetWithFeedIds", legacyChannel: "db-tags-get-with-feed-ids", kind: "invoke", targetCommand: "feeds.tags.listWithFeedIds", rustCommand: "feeds_tags_list_with_feed_ids" },
    { legacyMethod: "dbTagsUpsert", legacyChannel: "db-tags-upsert", kind: "invoke", targetCommand: "feeds.tags.upsert", rustCommand: "feeds_tags_upsert" },
    { legacyMethod: "dbTagsUpdate", legacyChannel: "db-tags-update", kind: "invoke", targetCommand: "feeds.tags.update", rustCommand: "feeds_tags_update" },
    { legacyMethod: "dbTagsRename", legacyChannel: "db-tags-rename", kind: "invoke", targetCommand: "feeds.tags.rename", rustCommand: "feeds_tags_rename" },
    { legacyMethod: "dbTagsDelete", legacyChannel: "db-tags-delete", kind: "invoke", targetCommand: "feeds.tags.delete", rustCommand: "feeds_tags_delete" },
    { legacyMethod: "dbTagsAddFeed", legacyChannel: "db-tags-add-feed", kind: "invoke", targetCommand: "feeds.tags.attachFeed", rustCommand: "feeds_tags_attach_feed" },
    { legacyMethod: "dbTagsRemoveFeed", legacyChannel: "db-tags-remove-feed", kind: "invoke", targetCommand: "feeds.tags.detachFeed", rustCommand: "feeds_tags_detach_feed" },
    { legacyMethod: "dbTagsGetFeedIds", legacyChannel: "db-tags-get-feed-ids", kind: "invoke", targetCommand: "feeds.tags.listFeedIds", rustCommand: "feeds_tags_list_feed_ids" },
    { legacyMethod: "dbTagsGetByFeed", legacyChannel: "db-tags-get-by-feed", kind: "invoke", targetCommand: "feeds.tags.listByFeed", rustCommand: "feeds_tags_list_by_feed" },
  ],
  articles: [
    { legacyMethod: "parseArticle", legacyChannel: "parse-article", kind: "renderer", targetCommand: "articles.parse", notes: "Renderer composes feeds_fetch plus article extraction." },
    { legacyMethod: "fetchHtmlSafe", legacyChannel: "fetch-html-safe", kind: "invoke", targetCommand: "articles.fetchHtmlSafe", rustCommand: "feeds_fetch_html_safe" },
    { legacyMethod: "dbArticlesQuery", legacyChannel: "db-articles-query", kind: "invoke", targetCommand: "articles.query", rustCommand: "articles_query" },
    { legacyMethod: "dbArticlesGet", legacyChannel: "db-articles-get", kind: "invoke", targetCommand: "articles.get", rustCommand: "articles_get" },
    { legacyMethod: "dbArticlesGetContent", legacyChannel: "db-articles-get-content", kind: "invoke", targetCommand: "articles.getContent", rustCommand: "articles_get_content" },
    { legacyMethod: "dbArticlesExists", legacyChannel: "db-articles-exists", kind: "invoke", targetCommand: "articles.exists", rustCommand: "articles_exists" },
    { legacyMethod: "dbArticlesInsertBatch", legacyChannel: "db-articles-insert-batch", kind: "invoke", targetCommand: "articles.insertBatch", rustCommand: "articles_insert_batch" },
    { legacyMethod: "dbArticlesUpdateRead", legacyChannel: "db-articles-update-read", kind: "invoke", targetCommand: "articles.updateRead", rustCommand: "articles_update_read" },
    { legacyMethod: "dbArticlesUpdateLastReadAt", legacyChannel: "db-articles-update-last-read-at", kind: "invoke", targetCommand: "articles.updateLastReadAt", rustCommand: "articles_update_last_read_at" },
    { legacyMethod: "dbArticlesToggleStarred", legacyChannel: "db-articles-toggle-starred", kind: "invoke", targetCommand: "articles.toggleStarred", rustCommand: "articles_toggle_starred" },
    { legacyMethod: "dbArticlesUpdateSaved", legacyChannel: "db-articles-update-saved", kind: "invoke", targetCommand: "articles.updateSavedState", rustCommand: "articles_update_saved_state" },
    { legacyMethod: "dbArticlesDeleteByFeed", legacyChannel: "db-articles-delete-by-feed", kind: "invoke", targetCommand: "articles.deleteByFeed", rustCommand: "articles_delete_by_feed" },
    { legacyMethod: "dbArticlesCleanOld", legacyChannel: "db-articles-clean-old", kind: "invoke", targetCommand: "articles.cleanOldByFeed", rustCommand: "articles_clean_old_by_feed" },
    { legacyMethod: "dbArticlesCleanOldAcrossFeeds", legacyChannel: "db-articles-clean-old-across-feeds", kind: "invoke", targetCommand: "articles.cleanOldAcrossFeeds", rustCommand: "articles_clean_old_across_feeds" },
    { legacyMethod: "dbArticlesUnreadCount", legacyChannel: "db-articles-unread-count", kind: "invoke", targetCommand: "articles.countUnreadByFeed", rustCommand: "articles_count_unread_by_feed" },
    { legacyMethod: "dbArticlesCount", legacyChannel: "db-articles-count", kind: "invoke", targetCommand: "articles.countByFeed", rustCommand: "articles_count_by_feed" },
    { legacyMethod: "dbArticlesUpdateFeedMeta", legacyChannel: "db-articles-update-feed-meta", kind: "invoke", targetCommand: "articles.updateFeedMeta", rustCommand: "articles_update_feed_meta" },
  ],
  saved: [
    { legacyMethod: "pickSavedArticlesSyncFolder", legacyChannel: "saved-articles-sync-pick-folder", kind: "invoke", targetCommand: "saved.sync.pickFolder", rustCommand: "shell_dialog_pick_folder" },
    { legacyMethod: "queueSavedArticlesFolderSync", legacyChannel: "saved-articles-sync-queue", kind: "invoke", targetCommand: "saved.sync.queue", rustCommand: "saved_sync_queue" },
    { legacyMethod: "pickSavedArticlesExportPath", legacyChannel: "saved-articles-export-pick-path", kind: "invoke", targetCommand: "saved.export.pickPath", rustCommand: "shell_dialog_save_file" },
    { legacyMethod: "getSavedArticlesExportPreflight", legacyChannel: "saved-articles-export-preflight", kind: "invoke", targetCommand: "saved.export.preflight", rustCommand: "saved_export_preflight" },
    { legacyMethod: "startSavedArticlesExport", legacyChannel: "saved-articles-export-start", kind: "invoke", targetCommand: "saved.export.start", rustCommand: "saved_export_start" },
    { legacyMethod: "onSavedArticlesExportEvent", legacyChannel: "saved-articles-export:event", kind: "event", targetCommand: "saved.export.onProgress" },
    { legacyMethod: "dbSavedInsert", legacyChannel: "db-saved-insert", kind: "invoke", targetCommand: "saved.create", rustCommand: "saved_create" },
    { legacyMethod: "dbSavedInsertBatch", legacyChannel: "db-saved-insert-batch", kind: "invoke", targetCommand: "saved.insertBatch", rustCommand: "saved_insert_batch" },
    { legacyMethod: "dbSavedDelete", legacyChannel: "db-saved-delete", kind: "invoke", targetCommand: "saved.delete", rustCommand: "saved_delete" },
    { legacyMethod: "dbSavedGet", legacyChannel: "db-saved-get", kind: "invoke", targetCommand: "saved.get", rustCommand: "saved_get" },
    { legacyMethod: "dbSavedGetByHash", legacyChannel: "db-saved-get-by-hash", kind: "invoke", targetCommand: "saved.getByArticleHash", rustCommand: "saved_get_by_article_hash" },
    { legacyMethod: "dbSavedGetByLink", legacyChannel: "db-saved-get-by-link", kind: "invoke", targetCommand: "saved.getByLink", rustCommand: "saved_get_by_link" },
    { legacyMethod: "dbSavedGetAll", legacyChannel: "db-saved-get-all", kind: "invoke", targetCommand: "saved.listAll", rustCommand: "saved_list_all" },
    { legacyMethod: "dbSavedQuery", legacyChannel: "db-saved-query", kind: "invoke", targetCommand: "saved.query", rustCommand: "saved_query" },
    { legacyMethod: "dbSavedGetContent", legacyChannel: "db-saved-get-content", kind: "invoke", targetCommand: "saved.getContent", rustCommand: "saved_get_content" },
    { legacyMethod: "dbSavedUpdateHighlights", legacyChannel: "db-saved-update-highlights", kind: "invoke", targetCommand: "saved.updateHighlights", rustCommand: "saved_update_highlights" },
    { legacyMethod: "dbSavedUpdateNotes", legacyChannel: "db-saved-update-notes", kind: "invoke", targetCommand: "saved.updateNotes", rustCommand: "saved_update_notes" },
    { legacyMethod: "dbSavedUpdateLastReadAt", legacyChannel: "db-saved-update-last-read-at", kind: "invoke", targetCommand: "saved.updateLastReadAt", rustCommand: "saved_update_last_read_at" },
  ],
  settings: [
    { legacyMethod: "storageGet", legacyChannel: "storage-get", kind: "invoke", targetCommand: "settings.get", rustCommand: "settings_get", notes: "The Tauri app returns a normalized settings document instead of arbitrary key lookups." },
    { legacyMethod: "storageSet", legacyChannel: "storage-set", kind: "invoke", targetCommand: "settings.update", rustCommand: "settings_update", notes: "The Tauri app applies structured settings patches instead of per-key string writes." },
    { legacyMethod: "storageRemove", legacyChannel: "storage-remove", kind: "invoke", targetCommand: "settings.update", rustCommand: "settings_update", notes: "Nullable fields clear values through the same structured patch command." },
    { legacyMethod: "storageClear", legacyChannel: "storage-clear", kind: "invoke", targetCommand: "settings.reset", rustCommand: "settings_reset" },
    { legacyMethod: "storageGetAllKeys", legacyChannel: "storage-get-all-keys", kind: "invoke", targetCommand: "settings.get", rustCommand: "settings_get", notes: "Migration work now treats settings as one document, so enumeration is replaced by full-snapshot reads." },
    { legacyMethod: "notifySettingsChanged", legacyChannel: "notify-settings-changed", kind: "renderer", targetCommand: "settings.onChanged", notes: "Renderer emits settings-changed after native settings writes." },
    { legacyMethod: "onSettingsChanged", legacyChannel: "settings-changed", kind: "event", targetCommand: "settings.onChanged" },
  ],
  system: [
    { legacyMethod: "getSystemAppIconState", legacyChannel: "system-app-icon:get-state", kind: "invoke", targetCommand: "system.appIcon.getState", rustCommand: "system_app_icon_get_state" },
    { legacyMethod: "setSystemAppIconVariant", legacyChannel: "system-app-icon:set-variant", kind: "invoke", targetCommand: "system.appIcon.setVariant", rustCommand: "system_app_icon_set_variant" },
    { legacyMethod: "pickSystemAppIcon", legacyChannel: "system-app-icon:pick", kind: "invoke", targetCommand: "system.appIcon.pick", rustCommand: "system_app_icon_pick" },
    { legacyMethod: "resetSystemAppIcon", legacyChannel: "system-app-icon:reset", kind: "invoke", targetCommand: "system.appIcon.reset", rustCommand: "system_app_icon_reset" },
    { legacyMethod: "relaunchApplication", legacyChannel: "app-relaunch", kind: "invoke", targetCommand: "system.app.relaunch", rustCommand: "system_app_relaunch" },
    { legacyMethod: "getSystemAccentColor", legacyChannel: "get-system-accent-color", kind: "invoke", targetCommand: "system.theme.getAccentColor", rustCommand: "system_theme_get_accent_color" },
    { legacyMethod: "onSystemAccentColorChanged", legacyChannel: "system-accent-color-changed", kind: "event", targetCommand: "system.theme.onAccentColorChanged" },
    { legacyMethod: "readClipboard", legacyChannel: "read-clipboard", kind: "invoke", targetCommand: "system.clipboard.readText", rustCommand: "system_clipboard_read_text" },
    { legacyMethod: "writeClipboard", legacyChannel: "write-clipboard", kind: "invoke", targetCommand: "system.clipboard.writeText", rustCommand: "system_clipboard_write_text" },
  ],
  diagnostics: [
    { legacyMethod: "logEntry", legacyChannel: "log-entry", kind: "invoke", targetCommand: "diagnostics.log.writeEntry", rustCommand: "diagnostics_log_write_entry" },
    { legacyMethod: "getLogsPath", legacyChannel: "get-logs-path", kind: "invoke", targetCommand: "diagnostics.log.getPath", rustCommand: "diagnostics_log_get_path" },
    { legacyMethod: "perfSnapshot", legacyChannel: "perf-snapshot", kind: "invoke", targetCommand: "diagnostics.performance.snapshot", rustCommand: "diagnostics_performance_snapshot" },
    { legacyMethod: "exportDiagnostics", legacyChannel: "export-diagnostics", kind: "invoke", targetCommand: "diagnostics.exportBundle", rustCommand: "diagnostics_export_bundle" },
  ],
  tasks: [
    { legacyMethod: "helperTaskAdd", legacyChannel: "helper-task:add", kind: "renderer", targetCommand: "tasks.helper.add", notes: "Renderer-side helper queue during migration; invoke allowlisted until Rust task handlers land." },
    { legacyMethod: "helperTaskRemove", legacyChannel: "helper-task:remove", kind: "renderer", targetCommand: "tasks.helper.remove", notes: "Renderer-side helper queue during migration; invoke allowlisted until Rust task handlers land." },
    { legacyMethod: "helperTaskClear", legacyChannel: "helper-task:clear", kind: "renderer", targetCommand: "tasks.helper.clear", notes: "Renderer-side helper queue during migration; invoke allowlisted until Rust task handlers land." },
    { legacyMethod: "helperTaskGetQueueSnapshot", legacyChannel: "helper-task:queue-snapshot", kind: "renderer", targetCommand: "tasks.helper.getQueueSnapshot", notes: "Renderer-side helper queue during migration; invoke allowlisted until Rust task handlers land." },
    { legacyMethod: "onHelperTaskResult", legacyChannel: "helper-task:result", kind: "event", targetCommand: "tasks.helper.onResult" },
  ],
};
