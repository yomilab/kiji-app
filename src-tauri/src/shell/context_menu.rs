use serde::Serialize;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    AppHandle, Manager, State, Wry,
};
use tauri_plugin_opener::OpenerExt;

const MENU_OPEN_IMAGE: &str = "ctx-open-image";
const MENU_COPY_IMAGE: &str = "ctx-copy-image";

pub struct ImageContextMenuState {
    pending_src: Mutex<Option<String>>,
}

impl ImageContextMenuState {
    pub fn new() -> Self {
        Self {
            pending_src: Mutex::new(None),
        }
    }

    pub fn install(app: &AppHandle) -> Result<(), String> {
        app.manage(Self::new());

        let app_handle = app.clone();
        app.on_menu_event(move |app, event| {
            if event.id().as_ref() != MENU_OPEN_IMAGE && event.id().as_ref() != MENU_COPY_IMAGE {
                return;
            }

            let Some(state) = app.try_state::<ImageContextMenuState>() else {
                return;
            };

            let src = state
                .pending_src
                .lock()
                .ok()
                .and_then(|mut guard| guard.take());

            let Some(src) = src else {
                return;
            };

            match event.id().as_ref() {
                MENU_OPEN_IMAGE => {
                    let _ = app_handle.opener().open_url(src, None::<&str>);
                }
                MENU_COPY_IMAGE => {
                    if let Ok(mut clipboard) = arboard::Clipboard::new() {
                        let _ = clipboard.set_text(src);
                    }
                }
                _ => {}
            }
        });

        Ok(())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageContextMenuResult {
    pub shown: bool,
}

#[tauri::command(rename_all = "camelCase")]
pub fn shell_context_menu_show_image(
    app: AppHandle,
    src: String,
    state: State<'_, ImageContextMenuState>,
) -> Result<ImageContextMenuResult, String> {
    let trimmed = src.trim();
    if trimmed.is_empty() {
        return Ok(ImageContextMenuResult { shown: false });
    }

    let window = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("article"))
        .ok_or_else(|| "No active window is available for the image context menu.".to_string())?;

    {
        let mut pending = state
            .pending_src
            .lock()
            .map_err(|_| "Failed to lock the image context menu state.".to_string())?;
        *pending = Some(trimmed.to_string());
    }

    let menu = build_image_context_menu(&app)?;
    window
        .popup_menu(&menu)
        .map_err(|error| format!("Failed to show the image context menu: {error}"))?;

    Ok(ImageContextMenuResult { shown: true })
}

fn build_image_context_menu(app: &AppHandle) -> Result<Menu<Wry>, String> {
    let open_item = MenuItem::with_id(
        app,
        MENU_OPEN_IMAGE,
        "Open Image in Browser",
        true,
        None::<&str>,
    )
    .map_err(|error| format!("Failed to build the image context menu: {error}"))?;

    let copy_item = MenuItem::with_id(
        app,
        MENU_COPY_IMAGE,
        "Copy Image Address",
        true,
        None::<&str>,
    )
    .map_err(|error| format!("Failed to build the image context menu: {error}"))?;

    Menu::with_items(app, &[&open_item, &copy_item])
        .map_err(|error| format!("Failed to build the image context menu: {error}"))
}
