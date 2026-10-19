//! Keep KiJi running when the main window is closed, so feeds keep
//! refreshing and assistants can still connect.
//!
//! - macOS: closing hides the window; KiJi stays in the Dock and the Dock
//!   icon (RunEvent::Reopen) brings it back. Quit with ⌘Q / the menu.
//! - Windows/Linux: closing hides the window behind a tray icon (Open /
//!   Quit). Without a working tray (e.g. a Linux desktop with no tray
//!   support) closing quits as before, so KiJi never becomes invisible.
//!   A second launch focuses the running copy (single-instance plugin).

use crate::settings::SettingsState;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

pub const MAIN_WINDOW_LABEL: &str = "main";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloseAction {
    /// Hide the main window; the app keeps running.
    Hide,
    /// Quit the app (previous behavior).
    Exit,
}

/// Pure decision for a main-window close request.
pub fn close_action(keep_running: bool, is_macos: bool, tray_ready: bool) -> CloseAction {
    match (keep_running, is_macos, tray_ready) {
        (false, _, _) => CloseAction::Exit,
        (true, true, _) => CloseAction::Hide,
        (true, false, true) => CloseAction::Hide,
        (true, false, false) => CloseAction::Exit,
    }
}

#[derive(Default)]
pub struct BackgroundState {
    #[cfg(not(target_os = "macos"))]
    tray: Mutex<Option<tauri::tray::TrayIcon>>,
    #[cfg(target_os = "macos")]
    _unused: Mutex<()>,
}

impl BackgroundState {
    pub fn tray_ready(&self) -> bool {
        #[cfg(not(target_os = "macos"))]
        {
            self.tray.lock().map(|tray| tray.is_some()).unwrap_or(false)
        }
        #[cfg(target_os = "macos")]
        {
            false
        }
    }
}

fn keep_running_setting(app: &AppHandle) -> bool {
    app.try_state::<Arc<SettingsState>>()
        .and_then(|settings| settings.snapshot().ok())
        .map(|settings| settings.keep_running_in_background)
        .unwrap_or(false)
}

/// What to do when the main window asks to close.
pub fn main_window_close_action(app: &AppHandle) -> CloseAction {
    let tray_ready = app
        .try_state::<Arc<BackgroundState>>()
        .map(|state| state.tray_ready())
        .unwrap_or(false);
    close_action(keep_running_setting(app), cfg!(target_os = "macos"), tray_ready)
}

/// Hides the main window (leaving full screen first on macOS, otherwise
/// an empty full-screen Space is left behind).
pub fn hide_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else { return };
    #[cfg(target_os = "macos")]
    if window.is_fullscreen().unwrap_or(false) {
        let _ = window.set_fullscreen(false);
        let app = app.clone();
        // Let the full-screen exit animation finish before hiding.
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(700)).await;
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = window.hide();
            }
        });
        return;
    }
    let _ = window.hide();
}

pub fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else { return };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// Creates or removes the tray icon to match the setting (Windows/Linux).
pub fn apply(app: &AppHandle) {
    #[cfg(not(target_os = "macos"))]
    {
        let keep = keep_running_setting(app);
        let Some(state) = app.try_state::<Arc<BackgroundState>>() else { return };
        let Ok(mut tray) = state.tray.lock() else { return };
        match (keep, tray.is_some()) {
            (true, false) => match build_tray(app) {
                Ok(icon) => *tray = Some(icon),
                Err(error) => {
                    // No tray: closing keeps quitting (see close_action).
                    eprintln!("[KiJi] System tray unavailable: {error}");
                }
            },
            (false, true) => {
                if let Some(icon) = tray.take() {
                    let _ = icon.set_visible(false);
                }
            }
            _ => {}
        }
    }
    #[cfg(target_os = "macos")]
    let _ = app;
}

#[cfg(not(target_os = "macos"))]
fn build_tray(app: &AppHandle) -> tauri::Result<tauri::tray::TrayIcon> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let open = MenuItem::with_id(app, "kiji-tray-open", "Open KiJi", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "kiji-tray-quit", "Quit KiJi", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut builder = TrayIconBuilder::with_id("kiji-tray")
        .tooltip("KiJi")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "kiji-tray-open" => show_main_window(app),
            "kiji-tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundModeStatus {
    pub enabled: bool,
    /// "macos" | "windows" | "linux"
    pub platform: &'static str,
    /// Windows/Linux: the tray icon is showing (closing will hide).
    pub tray_ready: bool,
}

fn platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn status(app: &AppHandle) -> BackgroundModeStatus {
    BackgroundModeStatus {
        enabled: keep_running_setting(app),
        platform: platform_name(),
        tray_ready: app
            .try_state::<Arc<BackgroundState>>()
            .map(|state| state.tray_ready())
            .unwrap_or(false),
    }
}

#[tauri::command]
pub fn shell_background_mode_get(app: AppHandle) -> BackgroundModeStatus {
    status(&app)
}

#[tauri::command]
pub fn shell_background_mode_set(
    enabled: bool,
    app: AppHandle,
    settings: State<'_, Arc<SettingsState>>,
) -> Result<BackgroundModeStatus, String> {
    settings.set_keep_running_in_background(enabled)?;
    apply(&app);
    Ok(status(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_quits_unless_background_is_on_and_possible() {
        assert_eq!(close_action(false, true, false), CloseAction::Exit);
        assert_eq!(close_action(false, false, true), CloseAction::Exit);
        // macOS keeps running in the Dock; no tray needed.
        assert_eq!(close_action(true, true, false), CloseAction::Hide);
        // Windows/Linux hide only behind a working tray icon.
        assert_eq!(close_action(true, false, true), CloseAction::Hide);
        assert_eq!(close_action(true, false, false), CloseAction::Exit);
    }
}
