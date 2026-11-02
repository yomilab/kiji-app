//! Start a window drag from a mouse-down in one of the drag strips.
//!
//! Origin: KiJi Pocket `start_window_drag`, as ported to Highlights (`window_drag.rs`).
//!
//! The window API's `startDragging()` (and Tauri's `data-tauri-drag-region` script, which calls it)
//! is an `async` plugin command: it runs on the async runtime and tao then hands
//! `performWindowDragWithEvent:` the event loop's wake-up event instead of the mouse-down. On
//! macOS 27 that drag does nothing. And on macOS 27 (seen on 27.2) AppKit's own
//! `performWindowDragWithEvent:` is intermittent for every custom-title-bar app (Warp, Electron
//! apps, the Claude desktop app; warpdotdev/warp#16508), so there the window is moved by hand
//! instead: a thread polls the cursor while the button is held and sets the frame origin on the
//! main thread. Older systems get the native drag from a fresh left-mouse-down built at the cursor.
//! Rationale: `yomi-docs/docs/shared/tauri-stack/window-chrome.md` § Drag.

/// First macOS major version whose native window drag drops presses; move the window by hand from here on.
pub const MANUAL_DRAG_FROM_MACOS_MAJOR: isize = 27;

/// Whether this macOS major version needs the by-hand drag instead of AppKit's call.
pub fn needs_manual_drag(os_major: isize) -> bool {
    os_major >= MANUAL_DRAG_FROM_MACOS_MAJOR
}

#[tauri::command]
pub fn shell_window_drag_start(window: tauri::Window) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let ns_window = window.ns_window().map_err(|error| error.to_string())? as usize;
        if needs_manual_drag(macos::os_major()) {
            macos::track_by_hand(window, ns_window);
            return Ok(());
        }
        window
            .run_on_main_thread(move || unsafe { macos::perform_native(ns_window as *mut _) })
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    window.start_dragging().map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::{class, msg_send, runtime::AnyObject};
    use objc2_foundation::{NSOperatingSystemVersion, NSPoint, NSRect};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    };
    use std::time::Duration;

    const NS_EVENT_TYPE_LEFT_MOUSE_DOWN: usize = 1;
    const TICK: Duration = Duration::from_millis(8);
    /// Give up after this long even if the button still reads as held (a stuck tracker is worse than a dropped drag).
    const MAX_TICKS: u32 = 60_000 / 8;

    pub fn os_major() -> isize {
        unsafe {
            let info: *mut AnyObject = msg_send![class!(NSProcessInfo), processInfo];
            let version: NSOperatingSystemVersion = msg_send![info, operatingSystemVersion];
            version.majorVersion
        }
    }

    /// Native drag, like tao's fallback for a missing mouse event, with the location in window coordinates.
    pub unsafe fn perform_native(window: *mut AnyObject) {
        let screen: NSPoint = msg_send![class!(NSEvent), mouseLocation];
        let location: NSPoint = msg_send![window, convertPointFromScreen: screen];
        let number: isize = msg_send![window, windowNumber];
        let info: *mut AnyObject = msg_send![class!(NSProcessInfo), processInfo];
        let timestamp: f64 = msg_send![info, systemUptime];
        let event: *mut AnyObject = msg_send![
            class!(NSEvent),
            mouseEventWithType: NS_EVENT_TYPE_LEFT_MOUSE_DOWN,
            location: location,
            modifierFlags: 0usize,
            timestamp: timestamp,
            windowNumber: number,
            context: std::ptr::null_mut::<AnyObject>(),
            eventNumber: 0isize,
            clickCount: 1isize,
            pressure: 1.0f32
        ];
        if !event.is_null() {
            let _: () = msg_send![window, performWindowDragWithEvent: event];
        }
    }

    /// Move the window with the cursor until the left button is released. Loses edge snapping and
    /// dropping onto another Space; keeps the window under the menu bar via `constrainFrameRect`.
    pub fn track_by_hand(window: tauri::Window, ns_window: usize) {
        let done = Arc::new(AtomicBool::new(false));
        let anchor: Arc<Mutex<Option<(NSPoint, NSPoint)>>> = Arc::new(Mutex::new(None));
        std::thread::spawn(move || {
            for _ in 0..MAX_TICKS {
                let done_tick = done.clone();
                let anchor_tick = anchor.clone();
                let posted = window.run_on_main_thread(move || unsafe {
                    let w = ns_window as *mut AnyObject;
                    let buttons: usize = msg_send![class!(NSEvent), pressedMouseButtons];
                    if buttons & 1 == 0 {
                        done_tick.store(true, Ordering::Relaxed);
                        return;
                    }
                    let mouse: NSPoint = msg_send![class!(NSEvent), mouseLocation];
                    let mut frame: NSRect = msg_send![w, frame];
                    let mut guard = anchor_tick.lock().unwrap();
                    let (start_mouse, start_origin) = *guard.get_or_insert((mouse, frame.origin));
                    frame.origin.x = start_origin.x + (mouse.x - start_mouse.x);
                    frame.origin.y = start_origin.y + (mouse.y - start_mouse.y);
                    let screen: *mut AnyObject = msg_send![w, screen];
                    if !screen.is_null() {
                        frame = msg_send![w, constrainFrameRect: frame, toScreen: screen];
                    }
                    let _: () = msg_send![w, setFrameOrigin: frame.origin];
                });
                if posted.is_err() || done.load(Ordering::Relaxed) {
                    break;
                }
                std::thread::sleep(TICK);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manual_drag_starts_at_macos_27() {
        assert!(!needs_manual_drag(14));
        assert!(!needs_manual_drag(26));
        assert!(needs_manual_drag(27));
        assert!(needs_manual_drag(28));
    }

    /// The strips must call this command, not the window API's async `startDragging` (which macOS 27 ignores).
    #[test]
    fn drag_helper_invokes_the_plain_command() {
        let helper = include_str!("../../../src/services/ui/windowDrag.ts");
        assert!(
            helper.contains("'shell_window_drag_start'"),
            "windowDrag.ts must invoke shell_window_drag_start"
        );
        assert!(!helper.contains(".startDragging("), "windowDrag.ts must not call the async startDragging");
        let lib = include_str!("../lib.rs");
        assert!(lib.contains("shell_window_drag_start,"), "command must be in the invoke handler");
    }

    /// A drag from behind another app must start on the first press, as native title bars do.
    #[test]
    fn overlay_windows_accept_the_first_mouse() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.macos.conf.json")).expect("tauri.macos.conf.json");
        let windows = conf["app"]["windows"].as_array().expect("windows");
        assert!(!windows.is_empty(), "no windows");
        for window in windows {
            if window["titleBarStyle"] == "Overlay" {
                assert_eq!(
                    window["acceptFirstMouse"],
                    serde_json::Value::Bool(true),
                    "window {} must set acceptFirstMouse",
                    window["label"]
                );
            }
        }
    }
}
