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
    pub opml_path: Option<String>,
    pub bootstrap: String,
    pub auto_confirm: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct E2eCommandPayload {
    pub name: String,
    pub payload: serde_json::Value,
}

pub fn prepare_e2e_ui_before_window_restore(app: &AppHandle) {
    if !e2e_hide_ui_enabled() {
        return;
    }

    if let Some(main_window) = app.get_webview_window(MAIN_WEBVIEW_LABEL) {
        hide_main_window_for_e2e(&main_window);
    }
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
    let feed_url = std::env::var("KIJI_E2E_FEED_URL").unwrap_or_default();

    let feed_id = std::env::var("KIJI_E2E_FEED_ID").unwrap_or_else(|_| "e2e-feed".to_string());
    let scheduler_interval_ms = std::env::var("KIJI_E2E_SCHEDULER_INTERVAL_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(500);
    let opml_path = std::env::var("KIJI_E2E_OPML_PATH")
        .ok()
        .filter(|value| !value.is_empty());
    let bootstrap = std::env::var("KIJI_E2E_BOOTSTRAP").unwrap_or_else(|_| {
        if opml_path.is_some() {
            "opml".to_string()
        } else if feed_url.is_empty() {
            "none".to_string()
        } else {
            "feed".to_string()
        }
    });
    let auto_confirm = matches!(
        std::env::var("KIJI_E2E_AUTO_CONFIRM").ok().as_deref(),
        Some("1") | Some("true") | Some("yes")
    );

    Some(E2eHarnessConfig {
        dir: e2e_dir.to_string_lossy().into_owned(),
        feed_url,
        feed_id,
        scheduler_interval_ms,
        opml_path,
        bootstrap,
        auto_confirm,
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
    let opml_path_json = serde_json::to_string(&config.opml_path).unwrap_or_else(|_| "null".to_string());
    let bootstrap_json = serde_json::to_string(&config.bootstrap).unwrap_or_else(|_| "\"feed\"".to_string());
    let auto_confirm_json = if config.auto_confirm { "true" } else { "false" };

    let script = format!(
        "globalThis.__KIJI_E2E__ = {{ dir: {e2e_dir_json}, feedUrl: {feed_url_json}, feedId: {feed_id_json}, schedulerIntervalMs: Number({interval_json}), opmlPath: {opml_path_json}, bootstrap: {bootstrap_json}, autoConfirm: {auto_confirm_json} }};"
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
pub fn e2e_take_command() -> Result<Option<E2eCommandPayload>, String> {
    let e2e_dir = std::env::var_os("KIJI_E2E_DIR")
        .map(PathBuf::from)
        .ok_or_else(|| "KIJI_E2E_DIR is not set".to_string())?;
    let commands_dir = e2e_dir.join("commands");
    if !commands_dir.is_dir() {
        return Ok(None);
    }

    let mut entries = fs::read_dir(&commands_dir)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().map(|kind| kind.is_file()).unwrap_or(false))
        .collect::<Vec<_>>();

    entries.sort_by_key(|entry| entry.metadata().and_then(|meta| meta.modified()).ok());

    for entry in entries {
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if file_name == EMIT_RESUME_COMMAND {
            continue;
        }

        let path = entry.path();
        let raw = fs::read_to_string(&path).unwrap_or_default();
        let _ = fs::remove_file(&path);
        let name = path
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or(file_name);
        let payload = if raw.trim().is_empty() {
            serde_json::Value::Object(serde_json::Map::new())
        } else {
            serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new()))
        };

        return Ok(Some(E2eCommandPayload { name, payload }));
    }

    Ok(None)
}

#[tauri::command]
pub fn e2e_read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(Path::new(&path)).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn e2e_write_harness_text(relative_path: String, content: String) -> Result<(), String> {
    let e2e_dir = std::env::var_os("KIJI_E2E_DIR")
        .map(PathBuf::from)
        .ok_or_else(|| "KIJI_E2E_DIR is not set".to_string())?;
    let path = e2e_dir.join(relative_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, content).map_err(|error| error.to_string())
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

    #[test]
    fn e2e_bootstrap_defaults_to_opml_when_opml_path_set() {
        let config = E2eHarnessConfig {
            dir: "/tmp/e2e".to_string(),
            feed_url: "http://127.0.0.1/feed.xml".to_string(),
            feed_id: "e2e-feed".to_string(),
            scheduler_interval_ms: 500,
            opml_path: Some("/tmp/feeds.opml".to_string()),
            bootstrap: "opml".to_string(),
            auto_confirm: false,
        };
        assert_eq!(config.bootstrap, "opml");
        assert!(config.opml_path.is_some());
    }
}
