mod db;
mod settings;

use db::{db_get_status, DbState};
use settings::{settings_get, settings_reset, settings_update, SettingsState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let settings_state =
                SettingsState::load(&app.handle()).map_err(std::io::Error::other)?;
            let db_state = DbState::load(&app.handle()).map_err(std::io::Error::other)?;
            app.manage(settings_state);
            app.manage(db_state);
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            db_get_status,
            settings_get,
            settings_update,
            settings_reset
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
