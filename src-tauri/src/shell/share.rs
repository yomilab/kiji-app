use arboard::Clipboard;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[cfg(target_os = "macos")]
#[path = "share_macos.rs"]
mod share_macos;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ButtonRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRequest {
    pub title: String,
    pub url: String,
    pub button_rect: Option<ButtonRect>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareResponse {
    pub success: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareService {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn shell_share_list_services() -> Result<Vec<ShareService>, String> {
    if cfg!(target_os = "macos") {
        return Ok(vec![ShareService {
            id: "native".into(),
            name: "System Share Services".into(),
            icon: Some("share".into()),
        }]);
    }

    Ok(vec![])
}

#[tauri::command(rename_all = "camelCase")]
pub fn shell_share(app: AppHandle, request: ShareRequest) -> Result<ShareResponse, String> {
    let url = request.url.trim().to_string();
    if url.is_empty() {
        return Err("Share URL cannot be empty.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        use std::sync::{Arc, Mutex};

        let share_result = Arc::new(Mutex::new(None::<Result<(), String>>));
        let share_result_for_thread = Arc::clone(&share_result);
        let app_for_thread = app.clone();
        let request_for_thread = ShareRequest {
            title: request.title,
            url: request.url,
            button_rect: request.button_rect,
        };
        app.run_on_main_thread(move || {
            *share_result_for_thread
                .lock()
                .expect("share result lock poisoned") = Some(share_macos::present_share_sheet(
                &app_for_thread,
                &request_for_thread,
            ));
        })
        .map_err(|error| format!("Failed to dispatch share sheet: {error}"))?;

        if matches!(
            share_result
                .lock()
                .expect("share result lock poisoned")
                .take(),
            Some(Ok(()))
        ) {
            return Ok(ShareResponse { success: true });
        }
    }

    copy_share_url_to_clipboard(&url)?;
    Ok(ShareResponse { success: true })
}

#[tauri::command(rename_all = "camelCase")]
pub fn shell_share_to_service(
    app: AppHandle,
    request: ShareRequest,
    _service_id: String,
) -> Result<ShareResponse, String> {
    shell_share(app, request)
}

fn copy_share_url_to_clipboard(url: &str) -> Result<(), String> {
    let mut clipboard =
        Clipboard::new().map_err(|error| format!("Failed to open clipboard: {error}"))?;
    clipboard
        .set_text(url)
        .map_err(|error| format!("Failed to copy share URL to clipboard: {error}"))
}
