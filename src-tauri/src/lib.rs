mod db;
mod diagnostics;
mod net;
mod saved;
mod settings;
mod shell;
mod system;

use std::sync::Arc;

use db::{
    articles_clean_old_across_feeds, articles_clean_old_by_feed, articles_count_by_feed,
    articles_count_unread_by_feed, articles_delete_by_feed, articles_exists, articles_get,
    articles_get_content, articles_insert_batch, articles_query, articles_toggle_starred,
    articles_update_feed_meta, articles_update_last_read_at, articles_update_read,
    articles_update_saved_state, db_get_status, feeds_count, feeds_create, feeds_delete, feeds_get,
    feeds_get_by_url, feeds_list, feeds_tags_attach_feed, feeds_tags_delete,
    feeds_tags_detach_feed, feeds_tags_list, feeds_tags_list_by_feed, feeds_tags_list_feed_ids,
    feeds_tags_list_with_feed_ids, feeds_tags_rename, feeds_tags_update, feeds_tags_upsert,
    feeds_update, feeds_update_article_count, feeds_update_last_fetched, feeds_update_unread_count,
    saved_create, saved_delete, saved_get, saved_get_by_article_hash, saved_get_by_link,
    saved_get_content, saved_insert_batch, saved_list_all, saved_query, saved_update_highlights,
    saved_update_last_read_at, saved_update_notes, DbState,
};
use diagnostics::{
    diagnostics_export_bundle, diagnostics_log_get_path, diagnostics_log_write_entry,
    diagnostics_performance_snapshot, DiagnosticsState,
};
use net::{feeds_abort_request, feeds_fetch, feeds_fetch_data_url, feeds_fetch_with_cache};
use saved::{
    saved_export_preflight, saved_export_start, saved_sync_queue, SavedExportState, SavedSyncState,
};
use settings::{settings_get, settings_reset, settings_update, SettingsState};
use shell::{
    shell_dialog_open_file, shell_dialog_pick_folder, shell_dialog_save_file, shell_file_read_text,
    shell_file_write_text, shell_links_open_external,
};
use system::{system_clipboard_read_text, system_clipboard_write_text};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let settings_state = Arc::new(
                SettingsState::load(&app.handle()).map_err(std::io::Error::other)?,
            );
            let db_state =
                DbState::load(&app.handle()).map_err(std::io::Error::other)?;
            let sync_state = SavedSyncState::new(
                db_state.database_path(),
                Arc::clone(&settings_state),
            );
            sync_state.schedule_startup_reconcile();
            let diagnostics_state =
                DiagnosticsState::load(&app.handle()).map_err(std::io::Error::other)?;
            app.manage(settings_state);
            app.manage(db_state);
            app.manage(sync_state);
            app.manage(SavedExportState::new());
            app.manage(diagnostics_state);
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            articles_clean_old_across_feeds,
            articles_clean_old_by_feed,
            articles_count_by_feed,
            articles_count_unread_by_feed,
            articles_delete_by_feed,
            articles_exists,
            articles_get,
            articles_get_content,
            articles_insert_batch,
            articles_query,
            articles_toggle_starred,
            articles_update_feed_meta,
            articles_update_last_read_at,
            articles_update_read,
            articles_update_saved_state,
            db_get_status,
            diagnostics_export_bundle,
            diagnostics_log_get_path,
            diagnostics_log_write_entry,
            diagnostics_performance_snapshot,
            feeds_abort_request,
            feeds_count,
            feeds_create,
            feeds_delete,
            feeds_fetch,
            feeds_fetch_data_url,
            feeds_fetch_with_cache,
            feeds_get,
            feeds_get_by_url,
            feeds_list,
            feeds_tags_attach_feed,
            feeds_tags_delete,
            feeds_tags_detach_feed,
            feeds_tags_list,
            feeds_tags_list_by_feed,
            feeds_tags_list_feed_ids,
            feeds_tags_list_with_feed_ids,
            feeds_tags_rename,
            feeds_tags_update,
            feeds_tags_upsert,
            feeds_update,
            feeds_update_article_count,
            feeds_update_last_fetched,
            feeds_update_unread_count,
            saved_create,
            saved_delete,
            saved_export_preflight,
            saved_export_start,
            saved_get,
            saved_get_by_article_hash,
            saved_get_by_link,
            saved_get_content,
            saved_insert_batch,
            saved_list_all,
            saved_query,
            saved_sync_queue,
            saved_update_highlights,
            saved_update_last_read_at,
            saved_update_notes,
            shell_dialog_open_file,
            shell_dialog_pick_folder,
            shell_dialog_save_file,
            shell_file_read_text,
            shell_file_write_text,
            shell_links_open_external,
            settings_get,
            settings_update,
            settings_reset,
            system_clipboard_read_text,
            system_clipboard_write_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
