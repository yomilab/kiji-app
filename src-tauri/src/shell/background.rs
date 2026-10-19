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
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

pub const MAIN_WINDOW_LABEL: &str = "main";
#[cfg(not(target_os = "macos"))]
const TRAY_ID: &str = "kiji-tray";
#[cfg(target_os = "macos")]
const FULLSCREEN_EXIT_MAX_WAIT: std::time::Duration = std::time::Duration::from_secs(3);

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
    /// Bumped by every show; a pending delayed hide only runs if no show
    /// happened since it was scheduled.
    show_generation: AtomicU64,
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
    let generation = app
        .try_state::<Arc<BackgroundState>>()
        .map(|state| state.show_generation.load(Ordering::Acquire))
        .unwrap_or(0);
    #[cfg(target_os = "macos")]
    if window.is_fullscreen().unwrap_or(false) {
        let _ = window.set_fullscreen(false);
        let app = app.clone();
        // Hide once full screen has really ended (not a fixed delay), and
        // only if the user hasn't brought the window back meanwhile.
        tauri::async_runtime::spawn(async move {
            let started = std::time::Instant::now();
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else { return };
                if !hide_still_wanted(&app, generation) {
                    return;
                }
                let still_fullscreen = window.is_fullscreen().unwrap_or(false);
                if !still_fullscreen || started.elapsed() >= FULLSCREEN_EXIT_MAX_WAIT {
                    if !still_fullscreen {
                        // Let the exit animation settle before hiding.
                        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                        if !hide_still_wanted(&app, generation) {
                            return;
                        }
                    }
                    finish_hide(&app, &window);
                    return;
                }
            }
        });
        return;
    }
    finish_hide(app, &window);
}

fn hide_still_wanted(app: &AppHandle, generation: u64) -> bool {
    app.try_state::<Arc<BackgroundState>>()
        .map(|state| state.show_generation.load(Ordering::Acquire) == generation)
        .unwrap_or(true)
}

fn finish_hide(app: &AppHandle, window: &tauri::WebviewWindow) {
    let _ = window.hide();
    // Assistants: a hidden window isn't "what the user is reading".
    if let Some(assistant) = app.try_state::<Arc<crate::mcp::AssistantState>>() {
        assistant.window_hidden(MAIN_WINDOW_LABEL);
    }
    // While hidden, KiJi may be ended without a normal quit (logout,
    // shutdown, force quit). Checkpoint now so the database file is current.
    if let Some(db) = app.try_state::<crate::db::DbState>() {
        let db = db.inner().clone();
        std::thread::spawn(move || {
            if let Err(error) = db.checkpoint_wal() {
                eprintln!("[KiJi] Checkpoint on hide failed: {error}");
            }
        });
    }
}

pub fn main_window_is_visible(app: &AppHandle) -> bool {
    app.get_webview_window(MAIN_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(state) = app.try_state::<Arc<BackgroundState>>() {
        state.show_generation.fetch_add(1, Ordering::AcqRel);
    }
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else { return };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    if let Some(assistant) = app.try_state::<Arc<crate::mcp::AssistantState>>() {
        assistant.window_shown(MAIN_WINDOW_LABEL);
    }
}

/// Creates or removes the tray icon to match the setting (Windows/Linux).
pub fn apply(app: &AppHandle) {
    #[cfg(not(target_os = "macos"))]
    {
        let keep = keep_running_setting(app);
        let Some(state) = app.try_state::<Arc<BackgroundState>>() else { return };
        let Ok(mut tray) = state.tray.lock() else { return };
        match (keep, tray.is_some()) {
            (true, false) => {
                if !tray_host_available() {
                    eprintln!("[KiJi] No system tray on this desktop; closing the window will quit.");
                    return;
                }
                // libappindicator panics (instead of returning an error) when
                // its library is missing: never let that take the app down.
                match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| build_tray(app))) {
                    Ok(Ok(icon)) => *tray = Some(icon),
                    Ok(Err(error)) => eprintln!("[KiJi] System tray unavailable: {error}"),
                    Err(_) => eprintln!("[KiJi] System tray unavailable on this desktop."),
                }
            }
            (false, true) => {
                tray.take();
                // Dropping our handle doesn't remove it; Tauri keeps it by id.
                let _ = app.remove_tray_by_id(TRAY_ID);
            }
            _ => {}
        }
    }
    #[cfg(target_os = "macos")]
    let _ = app;
}

/// Linux: a tray icon only shows when a StatusNotifier host runs (KDE,
/// most desktops; GNOME only with the AppIndicator extension). Unknown →
/// assume yes. Other platforms: always.
#[cfg(not(target_os = "macos"))]
fn tray_host_available() -> bool {
    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("gdbus")
            .args([
                "call", "--session", "--timeout", "2",
                "--dest", "org.freedesktop.DBus",
                "--object-path", "/org/freedesktop/DBus",
                "--method", "org.freedesktop.DBus.NameHasOwner",
                "org.kde.StatusNotifierWatcher",
            ])
            .output();
        match output {
            Ok(output) if output.status.success() => parse_name_has_owner(&String::from_utf8_lossy(&output.stdout)).unwrap_or(true),
            _ => true,
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

/// `gdbus` prints `(true,)` / `(false,)`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_name_has_owner(output: &str) -> Option<bool> {
    let trimmed = output.trim();
    if trimmed.starts_with("(true") {
        Some(true)
    } else if trimmed.starts_with("(false") {
        Some(false)
    } else {
        None
    }
}

#[cfg(not(target_os = "macos"))]
fn build_tray(app: &AppHandle) -> tauri::Result<tauri::tray::TrayIcon> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let open = MenuItem::with_id(app, "kiji-tray-open", "Open KiJi", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "kiji-tray-quit", "Quit KiJi", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
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
    // Turning it off while the main window is hidden (e.g. from Settings)
    // must not leave KiJi running with no window and no tray.
    if !enabled && !main_window_is_visible(&app) {
        show_main_window(&app);
    }
    Ok(status(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_gdbus_name_has_owner_output() {
        assert_eq!(parse_name_has_owner("(true,)\n"), Some(true));
        assert_eq!(parse_name_has_owner("(false,)"), Some(false));
        assert_eq!(parse_name_has_owner("Error: no bus"), None);
    }

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
