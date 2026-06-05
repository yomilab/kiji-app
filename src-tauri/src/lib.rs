mod settings;

use tauri::Manager;
use settings::{settings_get, settings_reset, settings_update, SettingsState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let settings_state = SettingsState::load(&app.handle())
                .map_err(std::io::Error::other)?;
            app.manage(settings_state);
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            settings_get,
            settings_update,
            settings_reset
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
