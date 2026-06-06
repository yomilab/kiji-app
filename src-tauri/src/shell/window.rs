use crate::settings::SettingsState;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, LogicalSize, Manager, WebviewWindow, WindowEvent};

const SAVE_DEBOUNCE: Duration = Duration::from_millis(500);

pub fn restore_main_window_bounds(app: &AppHandle, settings: Arc<SettingsState>) -> Result<(), String> {
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

fn attach_main_window_bounds_listener(window: WebviewWindow, settings: Arc<SettingsState>) {
    let pending = Arc::new(Mutex::new(None::<tauri::async_runtime::JoinHandle<()>>));
    let window_for_events = window.clone();

    window.on_window_event(move |event| {
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
