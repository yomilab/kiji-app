use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow, WindowEvent};

use crate::scheduler::webview_delivery::{
    emit_scheduler_event_to_main_webview, RESUME_WAKE_SCRIPT,
};
use crate::system::SCHEDULER_SYSTEM_RESUME_EVENT;

const EMIT_RESUME_COMMAND: &str = "emit-system-resume";
const MAIN_WEBVIEW_LABEL: &str = "main";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct E2eHarnessConfig {
    pub dir: String,
    pub feed_url: String,
    pub feed_id: String,
    pub scheduler_interval_ms: u64,
}

pub fn start_e2e_harness(app: &AppHandle) {
    let Some(e2e_dir) = std::env::var_os("KIJI_E2E_DIR").map(PathBuf::from) else {
        return;
    };

    if let Err(error) = prepare_e2e_directories(&e2e_dir) {
        eprintln!("[E2E] Failed to prepare harness directories: {error}");
        return;
    }

    let _ = write_marker(
        &e2e_dir.join("events/rust-harness-started.json"),
        "rust-harness-started",
    );

    inject_e2e_globals(app, &e2e_dir);
    start_command_watcher(app.clone(), e2e_dir);
    start_e2e_ui_guard(app);
}

fn e2e_hide_ui_enabled() -> bool {
    e2e_hide_ui_enabled_for(
        std::env::var_os("KIJI_E2E_DIR").is_some(),
        std::env::var("KIJI_E2E_HIDE_UI").ok(),
    )
}

fn e2e_hide_ui_enabled_for(e2e_dir_set: bool, hide_ui: Option<String>) -> bool {
    if !e2e_dir_set {
        return false;
    }

    !matches!(
        hide_ui.as_deref(),
        Some("0") | Some("false") | Some("no")
    )
}

fn hide_main_window_for_e2e(window: &WebviewWindow) {
    let _ = window.set_skip_taskbar(true);
    let _ = window.hide();
}

fn start_e2e_ui_guard(app: &AppHandle) {
    if !e2e_hide_ui_enabled() {
        return;
    }

    if let Some(main_window) = app.get_webview_window(MAIN_WEBVIEW_LABEL) {
        hide_main_window_for_e2e(&main_window);
        let guard_window = main_window.clone();
        main_window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Focused(true)) {
                hide_main_window_for_e2e(&guard_window);
            }
        });
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        for _ in 0..40 {
            if let Some(main_window) = app_handle.get_webview_window(MAIN_WEBVIEW_LABEL) {
                hide_main_window_for_e2e(&main_window);
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    });
}

#[tauri::command]
pub fn e2e_get_config() -> Option<E2eHarnessConfig> {
    read_e2e_config()
}

fn read_e2e_config() -> Option<E2eHarnessConfig> {
    let e2e_dir = std::env::var_os("KIJI_E2E_DIR")?;
    let feed_url = std::env::var("KIJI_E2E_FEED_URL").ok()?;
    if feed_url.is_empty() {
        return None;
    }

    let feed_id = std::env::var("KIJI_E2E_FEED_ID").unwrap_or_else(|_| "e2e-feed".to_string());
    let scheduler_interval_ms = std::env::var("KIJI_E2E_SCHEDULER_INTERVAL_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(500);

    Some(E2eHarnessConfig {
        dir: e2e_dir.to_string_lossy().into_owned(),
        feed_url,
        feed_id,
        scheduler_interval_ms,
    })
}

fn prepare_e2e_directories(e2e_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(e2e_dir.join("commands"))
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(e2e_dir.join("events"))
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn inject_e2e_globals(app: &AppHandle, e2e_dir: &Path) {
    let Some(config) = read_e2e_config() else {
        return;
    };

    let e2e_dir_json = serde_json::to_string(&config.dir).unwrap_or_else(|_| "\"\"".to_string());
    let feed_url_json = serde_json::to_string(&config.feed_url).unwrap_or_else(|_| "\"\"".to_string());
    let feed_id_json = serde_json::to_string(&config.feed_id).unwrap_or_else(|_| "\"e2e-feed\"".to_string());
    let interval_json = config.scheduler_interval_ms.to_string();

    let script = format!(
        "globalThis.__KIJI_E2E__ = {{ dir: {e2e_dir_json}, feedUrl: {feed_url_json}, feedId: {feed_id_json}, schedulerIntervalMs: Number({interval_json}) }};"
    );

    let app_handle = app.clone();
    let e2e_dir = e2e_dir.to_path_buf();
    tauri::async_runtime::spawn(async move {
        for attempt in 0..120 {
            if let Some(main_window) = app_handle.get_webview_window(MAIN_WEBVIEW_LABEL) {
                if e2e_hide_ui_enabled() {
                    hide_main_window_for_e2e(&main_window);
                }
                if let Err(error) = main_window.eval(&script) {
                    eprintln!("[E2E] Failed to inject harness globals: {error}");
                } else if attempt >= 4 {
                    let _ = write_marker(
                        &e2e_dir.join("events/rust-globals-injected.json"),
                        "rust-globals-injected",
                    );
                    return;
                }
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        eprintln!("[E2E] Timed out waiting for main webview to inject harness globals");
    });
}

fn start_command_watcher(app: AppHandle, e2e_dir: PathBuf) {
    let running = Arc::new(AtomicBool::new(true));
    let watcher_running = Arc::clone(&running);
    let app_handle = app.clone();

    thread::Builder::new()
        .name("kiji-e2e-command-watcher".into())
        .spawn(move || {
            while watcher_running.load(Ordering::SeqCst) {
                let command_path = e2e_dir.join("commands").join(EMIT_RESUME_COMMAND);
                if command_path.is_file() {
                    emit_scheduler_event_to_main_webview(
                        &app_handle,
                        SCHEDULER_SYSTEM_RESUME_EVENT,
                        RESUME_WAKE_SCRIPT,
                        "E2E",
                    );
                    let _ = fs::remove_file(&command_path);
                    let _ = write_marker(&e2e_dir.join("events/resume-emitted.json"), "resume-emitted");
                }

                if app_handle
                    .get_webview_window(MAIN_WEBVIEW_LABEL)
                    .is_none()
                {
                    watcher_running.store(false, Ordering::SeqCst);
                    break;
                }

                thread::sleep(Duration::from_millis(100));
            }
        })
        .expect("spawn e2e command watcher");
}

fn write_marker(path: &Path, event_name: &str) -> Result<(), String> {
    let payload = serde_json::json!({
        "name": event_name,
        "at": chrono::Utc::now().timestamp_millis(),
    });
    fs::write(path, serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn e2e_write_event(name: String, payload_json: String) -> Result<(), String> {
    let e2e_dir = std::env::var_os("KIJI_E2E_DIR")
        .map(PathBuf::from)
        .ok_or_else(|| "KIJI_E2E_DIR is not set".to_string())?;
    let payload = serde_json::from_str::<serde_json::Value>(&payload_json)
        .unwrap_or_else(|_| serde_json::Value::Null);
    let body = serde_json::json!({
        "name": name,
        "payload": payload,
        "at": chrono::Utc::now().timestamp_millis(),
    });
    let path = e2e_dir.join("events").join(format!("{name}.json"));
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(
        path,
        serde_json::to_string_pretty(&body).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn e2e_resume_command_name_is_stable() {
        assert_eq!(EMIT_RESUME_COMMAND, "emit-system-resume");
    }

    #[test]
    fn e2e_hide_ui_defaults_to_enabled_when_env_present() {
        assert!(e2e_hide_ui_enabled_for(true, None));
        assert!(e2e_hide_ui_enabled_for(true, Some("1".to_string())));
        assert!(!e2e_hide_ui_enabled_for(true, Some("0".to_string())));
        assert!(!e2e_hide_ui_enabled_for(false, None));
    }
}
