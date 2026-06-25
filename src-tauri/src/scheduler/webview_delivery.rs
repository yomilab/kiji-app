use tauri::{AppHandle, Emitter, Manager};
use serde::Serialize;

pub const MAIN_WEBVIEW_LABEL: &str = "main";

pub const TICK_WAKE_SCRIPT: &str = "globalThis.__kijiSchedulerTick?.()";
pub const SLEEP_WAKE_SCRIPT: &str = "globalThis.__kijiSchedulerSleep?.()";
pub const RESUME_WAKE_SCRIPT: &str = "globalThis.__kijiSchedulerResume?.()";

pub fn emit_scheduler_event_to_main_webview(
    app: &AppHandle,
    event: &str,
    wake_script: &str,
    log_label: &str,
) {
    if let Some(main_window) = app.get_webview_window(MAIN_WEBVIEW_LABEL) {
        if let Err(error) = main_window.emit(event, ()) {
            eprintln!("[{log_label}] Failed to emit {event} to main webview: {error}");
        }

        if let Err(error) = main_window.eval(wake_script) {
            eprintln!("[{log_label}] Failed to wake {event} handler in main webview: {error}");
        }
        return;
    }

    if let Err(error) = app.emit(event, ()) {
        eprintln!("[{log_label}] Failed to emit {event}: {error}");
    }
}

pub fn emit_scheduler_payload_to_main_webview<T: Serialize>(
    app: &AppHandle,
    event: &str,
    payload: &T,
    log_label: &str,
) {
    if let Some(main_window) = app.get_webview_window(MAIN_WEBVIEW_LABEL) {
        if let Err(error) = main_window.emit(event, payload) {
            eprintln!("[{log_label}] Failed to emit {event} payload to main webview: {error}");
        }
        return;
    }

    if let Err(error) = app.emit(event, payload) {
        eprintln!("[{log_label}] Failed to emit {event} payload: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wake_scripts_target_optional_scheduler_globals() {
        assert_eq!(TICK_WAKE_SCRIPT, "globalThis.__kijiSchedulerTick?.()");
        assert_eq!(SLEEP_WAKE_SCRIPT, "globalThis.__kijiSchedulerSleep?.()");
        assert_eq!(RESUME_WAKE_SCRIPT, "globalThis.__kijiSchedulerResume?.()");
    }

    #[test]
    fn wake_scripts_are_distinct() {
        assert_ne!(TICK_WAKE_SCRIPT, SLEEP_WAKE_SCRIPT);
        assert_ne!(TICK_WAKE_SCRIPT, RESUME_WAKE_SCRIPT);
        assert_ne!(SLEEP_WAKE_SCRIPT, RESUME_WAKE_SCRIPT);
    }

    #[test]
    fn main_webview_label_matches_tauri_main_window() {
        assert_eq!(MAIN_WEBVIEW_LABEL, "main");
    }
}
