use tauri::WebviewWindow;

#[cfg(windows)]
use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
};
#[cfg(windows)]
use tauri::WindowEvent;

#[cfg(windows)]
const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) const DWMWCP_DONOTROUND: u32 = 1;
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) const DWMWCP_ROUND: u32 = 2;

#[cfg(windows)]
static ATTACHED_LABELS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn corner_preference_for_maximized(is_maximized: bool) -> u32 {
    if is_maximized {
        DWMWCP_DONOTROUND
    } else {
        DWMWCP_ROUND
    }
}

/// Win11 DWM rounding (~14px system corners). No-op on other OSes.
/// Failure must never fail `show` / `set_focus`.
pub fn apply_and_attach_native_window_radius(window: &WebviewWindow) {
    #[cfg(windows)]
    {
        apply_native_window_radius(window);
        attach_native_window_radius_listener(window);
    }

    #[cfg(not(windows))]
    {
        let _ = window;
    }
}

#[cfg(windows)]
fn apply_native_window_radius(window: &WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let is_maximized = window.is_maximized().unwrap_or(false);
    let preference = corner_preference_for_maximized(is_maximized);
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd.0 as *mut core::ffi::c_void,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            (&preference as *const u32).cast(),
            std::mem::size_of::<u32>() as u32,
        );
    }
}

#[cfg(windows)]
fn attach_native_window_radius_listener(window: &WebviewWindow) {
    let label = window.label().to_string();
    let attached = ATTACHED_LABELS.get_or_init(|| Mutex::new(HashSet::new()));
    if let Ok(mut labels) = attached.lock() {
        if !labels.insert(label.clone()) {
            return;
        }
    }

    let window_for_events = window.clone();
    window.on_window_event(move |event| {
        match event {
            WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
                apply_native_window_radius(&window_for_events);
            }
            WindowEvent::Destroyed => {
                if let Ok(mut labels) = attached.lock() {
                    labels.remove(window_for_events.label());
                }
            }
            _ => {}
        }
    });
}

#[cfg(windows)]
#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(
        hwnd: *mut core::ffi::c_void,
        dw_attribute: u32,
        pv_attribute: *const core::ffi::c_void,
        cb_attribute: u32,
    ) -> i32;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restored_and_maximized_windows_use_matching_dwm_corner_preference() {
        assert_eq!(corner_preference_for_maximized(false), DWMWCP_ROUND);
        assert_eq!(corner_preference_for_maximized(true), DWMWCP_DONOTROUND);
    }
}
