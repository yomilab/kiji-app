mod db;
mod diagnostics;
mod net;
mod saved;
mod scheduler;
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
    diagnostics_performance_snapshot, start_background_monitoring, DiagnosticsState,
};
use net::{
    feeds_abort_request, feeds_fetch, feeds_fetch_data_url, feeds_fetch_html_safe,
    feeds_fetch_with_cache,
};
use saved::{
    saved_export_preflight, saved_export_start, saved_sync_queue, SavedExportState, SavedSyncState,
};
use scheduler::{scheduler_reconfigure, scheduler_start, scheduler_stop, FeedSchedulerState};
use settings::{settings_get, settings_reset, settings_update, SettingsState};
use shell::{
    restore_main_window_bounds, shell_article_window_get_data, shell_article_window_open,
    shell_context_menu_show_image, shell_dialog_open_file, shell_main_window_apply_saved_bounds,
    shell_dialog_pick_folder, shell_dialog_save_file, shell_file_read_text, shell_file_write_text,
    shell_links_open_external, shell_menu_update_state, shell_settings_window_open, shell_share,
    shell_share_list_services, shell_share_to_service, window_guards_plugin, ApplicationMenu,
    ArticleWindowState, ImageContextMenuState,
};
use system::{
    start_accent_color_watch, system_app_icon_get_state, system_app_icon_pick,
    system_app_icon_reset, system_app_icon_set_variant, system_app_relaunch,
    system_clipboard_read_text, system_clipboard_write_text, system_theme_get_accent_color,
    AppIconState,
};
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let settings_state =
                Arc::new(SettingsState::load(&app.handle()).map_err(std::io::Error::other)?);
            let db_state = DbState::load(&app.handle()).map_err(|error| {
                eprintln!("[KiJi] Database startup failed: {error}");
                std::io::Error::other(error)
            })?;
            let sync_state =
                SavedSyncState::new(db_state.database_path(), Arc::clone(&settings_state));
            sync_state.schedule_startup_reconcile();
            let diagnostics_state =
                DiagnosticsState::load(&app.handle()).map_err(std::io::Error::other)?;
            let diagnostics_arc = Arc::new(diagnostics_state);
            start_background_monitoring(Arc::clone(&diagnostics_arc));
            let app_icon_state =
                AppIconState::load(&app.handle()).map_err(std::io::Error::other)?;

            ApplicationMenu::install(&app.handle()).map_err(std::io::Error::other)?;
            ImageContextMenuState::install(&app.handle()).map_err(std::io::Error::other)?;
            restore_main_window_bounds(&app.handle(), Arc::clone(&settings_state))
                .map_err(std::io::Error::other)?;
            app_icon_state
                .apply_configured_icon(&app.handle())
                .map_err(std::io::Error::other)?;
            start_accent_color_watch(&app.handle()).map_err(std::io::Error::other)?;

            app.manage(settings_state);
            app.manage(Arc::new(ArticleWindowState::new()));
            app.manage(db_state);
            app.manage(sync_state);
            app.manage(SavedExportState::new());
            app.manage(diagnostics_arc);
            app.manage(Arc::new(FeedSchedulerState::new()));
            app.manage(app_icon_state);
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(window_guards_plugin())
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
            feeds_fetch_html_safe,
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
            scheduler_reconfigure,
            scheduler_start,
            scheduler_stop,
            saved_update_highlights,
            saved_update_last_read_at,
            saved_update_notes,
            shell_context_menu_show_image,
            shell_dialog_open_file,
            shell_dialog_pick_folder,
            shell_dialog_save_file,
            shell_file_read_text,
            shell_file_write_text,
            shell_links_open_external,
            shell_menu_update_state,
            shell_main_window_apply_saved_bounds,
            shell_settings_window_open,
            shell_article_window_open,
            shell_article_window_get_data,
            shell_share,
            shell_share_list_services,
            shell_share_to_service,
            settings_get,
            settings_update,
            settings_reset,
            system_app_icon_get_state,
            system_app_icon_pick,
            system_app_icon_reset,
            system_app_icon_set_variant,
            system_app_relaunch,
            system_clipboard_read_text,
            system_clipboard_write_text,
            system_theme_get_accent_color,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(scheduler_state) = app_handle.try_state::<Arc<FeedSchedulerState>>() {
                    let _ = scheduler_state.stop();
                }
                if let Some(db_state) = app_handle.try_state::<DbState>() {
                    if let Err(error) = db_state.checkpoint_wal() {
                        eprintln!("[KiJi] Failed to checkpoint database WAL on exit: {error}");
                    }
                }
            }
        });
}
