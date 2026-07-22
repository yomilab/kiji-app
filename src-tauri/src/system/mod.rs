mod accent;
mod appearance;
mod app_icon;
mod power;

pub use accent::{start_accent_color_watch, system_theme_get_accent_color};
pub use appearance::{apply_app_appearance, system_appearance_set, ResolvedAppearance};
pub use power::{start_system_power_watch, SCHEDULER_SYSTEM_RESUME_EVENT};
pub use app_icon::{
    system_app_icon_get_state, system_app_icon_pick, system_app_icon_reset,
    system_app_icon_set_variant, system_app_relaunch, AppIconState,
};

#[tauri::command]
pub fn system_clipboard_read_text() -> Result<String, String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|error| format!("Failed to open clipboard: {error}"))?;
    clipboard
        .get_text()
        .map_err(|error| format!("Failed to read clipboard text: {error}"))
}

#[tauri::command]
pub fn system_clipboard_write_text(text: String) -> Result<(), String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|error| format!("Failed to open clipboard: {error}"))?;
    clipboard
        .set_text(text)
        .map_err(|error| format!("Failed to write clipboard text: {error}"))
}
