use crate::{
    settings::SettingsState,
    shell::window_bounds::{
        fit_window_bounds_to_displays, monitor_work_area_logical, SavedWindowBounds,
        MAIN_WINDOW_MIN_HEIGHT, MAIN_WINDOW_MIN_WIDTH,
    },
};
use serde_json::Value as JsonValue;
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const SAVE_DEBOUNCE: Duration = Duration::from_millis(500);
const SETTINGS_WINDOW_LABEL: &str = "settings";
const ARTICLE_WINDOW_LABEL: &str = "article";
const UPDATE_WINDOW_LABEL: &str = "update";
const MAIN_WINDOW_LABEL: &str = "main";
const UPDATE_WINDOW_OPEN_EVENT: &str = "update-window:open";

pub struct UpdateWindowState {
    payload: Mutex<Option<JsonValue>>,
}

impl UpdateWindowState {
    pub fn new() -> Self {
        Self {
            payload: Mutex::new(None),
        }
    }

    pub fn set_payload(&self, payload: JsonValue) -> Result<(), String> {
        let mut guard = self
            .payload
            .lock()
            .map_err(|_| "Update window state lock poisoned.".to_string())?;
        *guard = Some(payload);
        Ok(())
    }

    pub fn clone_payload(&self) -> Result<JsonValue, String> {
        let guard = self
            .payload
            .lock()
            .map_err(|_| "Update window state lock poisoned.".to_string())?;
        guard
            .clone()
            .ok_or_else(|| "No update payload was provided for the Tauri update window.".to_string())
    }
}

/// Labels of secondary windows that this process explicitly opened. Secondary
/// webviews that load without an entry here were recreated by macOS session
/// restore and should be torn down instead of silently booting a full
/// renderer (extra WebContent process + bundle parse on every launch).
#[derive(Default)]
pub struct UserInitiatedWindowsState(Mutex<HashSet<String>>);

impl UserInitiatedWindowsState {
    fn allow(&self, label: &str) {
        if let Ok(mut guard) = self.0.lock() {
            guard.insert(label.to_string());
        }
    }

    pub fn is_allowed(&self, label: &str) -> bool {
        if label == MAIN_WINDOW_LABEL {
            return true;
        }
        self.0
            .lock()
            .map(|guard| guard.contains(label))
            .unwrap_or(true)
    }
}

pub struct ArticleWindowState {
    payload: Mutex<Option<JsonValue>>,
}

impl ArticleWindowState {
    pub fn new() -> Self {
        Self {
            payload: Mutex::new(None),
        }
    }

    pub fn set_payload(&self, article: JsonValue) -> Result<(), String> {
        let mut guard = self
            .payload
            .lock()
            .map_err(|_| "Article window state lock poisoned.".to_string())?;
        *guard = Some(article);
        Ok(())
    }

    pub fn clone_payload(&self) -> Result<JsonValue, String> {
        let guard = self
            .payload
            .lock()
            .map_err(|_| "Article window state lock poisoned.".to_string())?;
        guard
            .clone()
            .ok_or_else(|| "No article payload was provided for the Tauri article window.".to_string())
    }
}

pub fn restore_main_window_bounds(
    app: &AppHandle,
    settings: Arc<SettingsState>,
    suppress_save: Arc<AtomicBool>,
) -> Result<(), String> {
    let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Ok(());
    };

    apply_main_window_bounds(&main_window, &settings, &suppress_save)?;
    attach_main_window_bounds_listener(main_window, settings, suppress_save);
    Ok(())
}

pub fn open_settings_window(app: &AppHandle) -> Result<(), String> {
    app.state::<UserInitiatedWindowsState>()
        .allow(SETTINGS_WINDOW_LABEL);
    let settings_window = match app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        Some(window) => window,
        None => {
            let settings_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == SETTINGS_WINDOW_LABEL)
                .ok_or_else(|| "Settings window config was not found.".to_string())?;

            WebviewWindowBuilder::from_config(app, settings_config)
                .map_err(|error| format!("Failed to prepare settings window: {error}"))?
                .build()
                .map_err(|error| format!("Failed to create settings window: {error}"))?
        }
    };

    let _ = settings_window.unminimize();
    settings_window
        .show()
        .map_err(|error| format!("Failed to show settings window: {error}"))?;
    settings_window
        .set_focus()
        .map_err(|error| format!("Failed to focus settings window: {error}"))
}

#[tauri::command]
pub fn shell_settings_window_open(app: AppHandle) -> Result<(), String> {
    open_settings_window(&app)
}

pub fn open_article_window(app: &AppHandle) -> Result<(), String> {
    open_secondary_window(app, ARTICLE_WINDOW_LABEL)
}

fn open_secondary_window(app: &AppHandle, label: &str) -> Result<(), String> {
    app.state::<UserInitiatedWindowsState>().allow(label);
    let window = match app.get_webview_window(label) {
        Some(window) => window,
        None => {
            let window_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == label)
                .ok_or_else(|| format!("{label} window config was not found."))?;

            WebviewWindowBuilder::from_config(app, window_config)
                .map_err(|error| format!("Failed to prepare {label} window: {error}"))?
                .build()
                .map_err(|error| format!("Failed to create {label} window: {error}"))?
        }
    };

    let _ = window.unminimize();
    window
        .show()
        .map_err(|error| format!("Failed to show {label} window: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("Failed to focus {label} window: {error}"))
}

fn emit_secondary_window_open(app: &AppHandle, label: &str, event_name: &str) -> Result<(), String> {
    let Some(window) = app.get_webview_window(label) else {
        return Ok(());
    };
    window
        .emit(event_name, ())
        .map_err(|error| format!("Failed to emit {event_name}: {error}"))
}

#[tauri::command(rename_all = "camelCase")]
pub fn shell_article_window_open(
    app: AppHandle,
    article: JsonValue,
    state: State<'_, Arc<ArticleWindowState>>,
) -> Result<(), String> {
    state.set_payload(article)?;
    open_article_window(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub fn shell_article_window_get_data(
    window: WebviewWindow,
    state: State<'_, Arc<ArticleWindowState>>,
) -> Result<JsonValue, String> {
    if window.label() != ARTICLE_WINDOW_LABEL {
        return Err(format!(
            "Article window payload can only be read from the article webview (got {}).",
            window.label()
        ));
    }
    state.clone_payload()
}

#[tauri::command(rename_all = "camelCase")]
pub fn shell_update_window_open(
    app: AppHandle,
    payload: JsonValue,
    state: State<'_, Arc<UpdateWindowState>>,
) -> Result<(), String> {
    state.set_payload(payload)?;
    let existed = app.get_webview_window(UPDATE_WINDOW_LABEL).is_some();
    open_secondary_window(&app, UPDATE_WINDOW_LABEL)?;
    if existed {
        emit_secondary_window_open(&app, UPDATE_WINDOW_LABEL, UPDATE_WINDOW_OPEN_EVENT)?;
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn shell_update_window_get_data(
    window: WebviewWindow,
    state: State<'_, Arc<UpdateWindowState>>,
) -> Result<JsonValue, String> {
    if window.label() != UPDATE_WINDOW_LABEL {
        return Err(format!(
            "Update window payload can only be read from the update webview (got {}).",
            window.label()
        ));
    }
    state.clone_payload()
}

fn apply_main_window_bounds(
    main_window: &WebviewWindow,
    settings: &SettingsState,
    suppress_save: &Arc<AtomicBool>,
) -> Result<(), String> {
    suppress_save.store(true, Ordering::Release);

    let result = apply_main_window_bounds_inner(main_window, settings);

    let suppress_save_for_clear = Arc::clone(suppress_save);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SAVE_DEBOUNCE + Duration::from_millis(100)).await;
        suppress_save_for_clear.store(false, Ordering::Release);
    });

    result
}

fn apply_main_window_bounds_inner(
    main_window: &WebviewWindow,
    settings: &SettingsState,
) -> Result<(), String> {
    let snapshot = settings.snapshot()?;
    let saved = SavedWindowBounds {
        width: snapshot.window_size.width,
        height: snapshot.window_size.height,
        x: snapshot.window_size.x,
        y: snapshot.window_size.y,
    };

    let monitors = main_window
        .available_monitors()
        .map_err(|error| format!("Failed to list available monitors: {error}"))?;
    let work_areas = monitors
        .iter()
        .map(monitor_work_area_logical)
        .collect::<Vec<_>>();
    let primary = main_window
        .primary_monitor()
        .ok()
        .flatten()
        .as_ref()
        .map(monitor_work_area_logical);

    let fitted = fit_window_bounds_to_displays(
        saved,
        &work_areas,
        primary,
        MAIN_WINDOW_MIN_WIDTH,
        MAIN_WINDOW_MIN_HEIGHT,
    );

    main_window
        .set_size(LogicalSize::new(
            fitted.width as f64,
            fitted.height as f64,
        ))
        .map_err(|error| format!("Failed to restore the main window size: {error}"))?;
    main_window
        .set_position(LogicalPosition::new(fitted.x as f64, fitted.y as f64))
        .map_err(|error| format!("Failed to restore the main window position: {error}"))?;

    if fitted.adjusted {
        if let Err(error) = settings.update_window_bounds(fitted.width, fitted.height, Some(fitted.x), Some(fitted.y)) {
            eprintln!("[WindowBounds] Failed to persist display-safe main window bounds: {error}");
        }
    }

    Ok(())
}

fn read_main_window_bounds_logical(
    window: &WebviewWindow,
) -> Option<(u32, u32, Option<i32>, Option<i32>)> {
    let size = window.inner_size().ok()?;
    if size.width == 0 || size.height == 0 {
        return None;
    }

    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let logical_width = (size.width as f64 / scale_factor).round().max(1.0) as u32;
    let logical_height = (size.height as f64 / scale_factor).round().max(1.0) as u32;
    let logical_position = window.outer_position().ok().map(|position| {
        (
            (position.x as f64 / scale_factor).round() as i32,
            (position.y as f64 / scale_factor).round() as i32,
        )
    });

    let (x, y) = logical_position
        .map(|(x, y)| (Some(x), Some(y)))
        .unwrap_or((None, None));

    Some((logical_width, logical_height, x, y))
}

fn persist_main_window_bounds(window: &WebviewWindow, settings: &SettingsState) -> Result<(), String> {
    let Some((width, height, x, y)) = read_main_window_bounds_logical(window) else {
        return Ok(());
    };

    settings.update_window_bounds(width, height, x, y)
}

fn attach_main_window_bounds_listener(
    window: WebviewWindow,
    settings: Arc<SettingsState>,
    suppress_save: Arc<AtomicBool>,
) {
    let pending = Arc::new(Mutex::new(None::<tauri::async_runtime::JoinHandle<()>>));
    let window_for_events = window.clone();
    let app_handle = window.app_handle().clone();

    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();

            if let Ok(mut guard) = pending.lock() {
                if let Some(handle) = guard.take() {
                    handle.abort();
                }
            }

            if let Err(error) = persist_main_window_bounds(&window_for_events, &settings) {
                eprintln!("[WindowBounds] Failed to save main window bounds on close: {error}");
            }

            // Exit from a worker thread so RequestExit is not handled re-entrantly
            // on the main-thread CloseRequested stack (that path can abort).
            let app_handle = app_handle.clone();
            std::thread::spawn(move || {
                app_handle.exit(0);
            });
            return;
        }

        if suppress_save.load(Ordering::Acquire) {
            return;
        }

        if !matches!(event, WindowEvent::Resized(_) | WindowEvent::Moved(_)) {
            return;
        }

        let settings = Arc::clone(&settings);
        let pending = Arc::clone(&pending);
        let suppress_save = Arc::clone(&suppress_save);
        let window = window_for_events.clone();

        let Ok(mut guard) = pending.lock() else {
            return;
        };

        if let Some(handle) = guard.take() {
            handle.abort();
        }

        *guard = Some(tauri::async_runtime::spawn(async move {
            tokio::time::sleep(SAVE_DEBOUNCE).await;

            if suppress_save.load(Ordering::Acquire) {
                return;
            }

            let Some((logical_width, logical_height, x, y)) =
                read_main_window_bounds_logical(&window)
            else {
                return;
            };

            if let Err(error) =
                settings.update_window_bounds(logical_width, logical_height, x, y)
            {
                eprintln!("[WindowBounds] Failed to save main window bounds: {error}");
            }
        }));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn article_window_state_stores_and_clones_payload() {
        let state = ArticleWindowState::new();
        let article = json!({ "hash": "abc", "title": "Example" });

        state.set_payload(article.clone()).expect("payload should store");
        let first = state.clone_payload().expect("payload should load");
        let second = state.clone_payload().expect("payload should load again");
        assert_eq!(first, article);
        assert_eq!(second, article);
    }

    #[test]
    fn article_window_state_reopen_replaces_payload() {
        let state = ArticleWindowState::new();
        let first = json!({ "hash": "first", "title": "First" });
        let second = json!({ "hash": "second", "title": "Second" });

        state.set_payload(first).expect("first payload should store");
        assert_eq!(state.clone_payload().unwrap()["hash"], "first");

        state.set_payload(second.clone()).expect("second payload should store");
        assert_eq!(state.clone_payload().unwrap(), second);
    }
}
