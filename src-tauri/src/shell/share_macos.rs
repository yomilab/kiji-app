use super::{ButtonRect, ShareRequest};
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::AnyThread;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSSharingServicePicker, NSView};
use objc2_foundation::{NSArray, NSPoint, NSRect, NSRectEdge, NSSize, NSString, NSURL};
use tauri::{AppHandle, Manager, WebviewWindow};

pub fn present_share_sheet(app: &AppHandle, request: &ShareRequest) -> Result<(), String> {
    let _mtm = MainThreadMarker::new().ok_or("Share sheet must run on the main thread.")?;

    let url_string = request.url.trim();
    if url_string.is_empty() {
        return Err("Share URL cannot be empty.".to_string());
    }

    let ns_url = NSURL::URLWithString(&NSString::from_str(url_string))
        .ok_or_else(|| format!("Invalid share URL: {url_string}"))?;
    let share_item: Retained<AnyObject> = ns_url.into_super().into();
    let items = NSArray::<AnyObject>::from_retained_slice(&[share_item]);

    let picker = unsafe {
        NSSharingServicePicker::initWithItems(NSSharingServicePicker::alloc(), &*items)
    };

    let window = resolve_share_window(app)?;
    let ns_view_ptr = window
        .ns_view()
        .map_err(|error| format!("Failed to resolve share anchor view: {error}"))?;
    let view = unsafe { &*ns_view_ptr.cast::<NSView>() };
    let anchor = share_anchor_rect(request.button_rect.as_ref());

    picker.showRelativeToRect_ofView_preferredEdge(anchor, view, NSRectEdge::MinY);
    Ok(())
}

fn resolve_share_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    for label in ["article", "main", "settings"] {
        if let Some(window) = app.get_webview_window(label) {
            if window.is_focused().unwrap_or(false) {
                return Ok(window);
            }
        }
    }

    app.get_webview_window("main")
        .or_else(|| app.get_webview_window("article"))
        .ok_or_else(|| "No webview window is available for the share sheet.".to_string())
}

fn share_anchor_rect(button_rect: Option<&ButtonRect>) -> NSRect {
    if let Some(rect) = button_rect {
        return NSRect::new(
            NSPoint::new(rect.x + rect.width + 10.0, rect.y + rect.height + 13.0),
            NSSize::new(1.0, 1.0),
        );
    }

    NSRect::new(NSPoint::new(100.0, 100.0), NSSize::new(1.0, 1.0))
}
