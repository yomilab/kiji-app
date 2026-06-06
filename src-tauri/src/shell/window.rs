use crate::settings::SettingsState;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, LogicalSize, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const SAVE_DEBOUNCE: Duration = Duration::from_millis(500);
const SETTINGS_WINDOW_LABEL: &str = "settings";

pub fn restore_main_window_bounds(
    app: &AppHandle,
    settings: Arc<SettingsState>,
) -> Result<(), String> {
    let Some(main_window) = app.get_webview_window("main") else {
        return Ok(());
    };

    let snapshot = settings.snapshot()?;
    let size = LogicalSize::new(
        snapshot.window_size.width as f64,
        snapshot.window_size.height as f64,
    );
    main_window
        .set_size(size)
        .map_err(|error| format!("Failed to restore the main window size: {error}"))?;

    attach_main_window_bounds_listener(main_window, settings);
    Ok(())
}

pub fn open_settings_window(app: &AppHandle) -> Result<(), String> {
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

fn attach_main_window_bounds_listener(window: WebviewWindow, settings: Arc<SettingsState>) {
    let pending = Arc::new(Mutex::new(None::<tauri::async_runtime::JoinHandle<()>>));
    let window_for_events = window.clone();
    let app_handle = window.app_handle().clone();

    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            app_handle.exit(0);
            return;
        }

        if !matches!(event, WindowEvent::Resized(_) | WindowEvent::Moved(_)) {
            return;
        }

        let settings = Arc::clone(&settings);
        let pending = Arc::clone(&pending);
        let window = window_for_events.clone();

        let Ok(mut guard) = pending.lock() else {
            return;
        };

        if let Some(handle) = guard.take() {
            handle.abort();
        }

        *guard = Some(tauri::async_runtime::spawn(async move {
            tokio::time::sleep(SAVE_DEBOUNCE).await;
            let Ok(size) = window.outer_size() else {
                return;
            };

            if size.width == 0 || size.height == 0 {
                return;
            }

            let scale_factor = window.scale_factor().unwrap_or(1.0);
            let logical_width = (size.width as f64 / scale_factor).round().max(1.0) as u32;
            let logical_height = (size.height as f64 / scale_factor).round().max(1.0) as u32;

            if let Err(error) = settings.update_window_size(logical_width, logical_height) {
                eprintln!("[WindowBounds] Failed to save main window bounds: {error}");
            }
        }));
    });
}
