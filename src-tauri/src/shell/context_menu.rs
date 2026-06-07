use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    AppHandle, Manager, State, Wry,
};
use tauri_plugin_opener::OpenerExt;

const MENU_OPEN_LINK: &str = "ctx-open-link";
const MENU_COPY_LINK: &str = "ctx-copy-link";
const MENU_OPEN_IMAGE: &str = "ctx-open-image";
const MENU_COPY_IMAGE: &str = "ctx-copy-image";
const MENU_DOWNLOAD_IMAGE: &str = "ctx-download-image";
const MAX_IMAGE_DOWNLOAD_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArticleContextMenuKind {
    Link,
    Image,
}

impl ArticleContextMenuKind {
    fn from_request(value: &str) -> Option<Self> {
        match value {
            "link" => Some(Self::Link),
            "image" => Some(Self::Image),
            _ => None,
        }
    }
}

struct PendingArticleContextMenu {
    url: String,
}

pub struct ImageContextMenuState {
    pending: Mutex<Option<PendingArticleContextMenu>>,
}

impl ImageContextMenuState {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(None),
        }
    }

    pub fn install(app: &AppHandle) -> Result<(), String> {
        app.manage(Self::new());
        Ok(())
    }

    pub fn handle_menu_event(app: &AppHandle, menu_id: &str) -> bool {
        match menu_id {
            MENU_OPEN_LINK | MENU_COPY_LINK | MENU_OPEN_IMAGE | MENU_COPY_IMAGE
            | MENU_DOWNLOAD_IMAGE => {}
            _ => return false,
        }

        let Some(state) = app.try_state::<ImageContextMenuState>() else {
            return false;
        };

        let pending = state
            .pending
            .lock()
            .ok()
            .and_then(|mut guard| guard.take());

        let Some(pending) = pending else {
            return true;
        };

        let url = pending.url;
        let app_handle = app.clone();

        match menu_id {
            MENU_OPEN_LINK | MENU_OPEN_IMAGE => {
                let _ = app_handle.opener().open_url(url, None::<&str>);
            }
            MENU_COPY_LINK | MENU_COPY_IMAGE => {
                if let Ok(mut clipboard) = arboard::Clipboard::new() {
                    let _ = clipboard.set_text(url);
                }
            }
            MENU_DOWNLOAD_IMAGE => {
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = download_image_to_file(&url).await {
                        eprintln!("[ArticleContextMenu] Failed to download image: {error}");
                    }
                });
            }
            _ => {}
        }

        true
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowArticleContextMenuRequest {
    #[serde(alias = "src")]
    pub url: String,
    #[serde(default = "default_image_kind")]
    pub kind: String,
    pub window_label: Option<String>,
}

fn default_image_kind() -> String {
    "image".to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageContextMenuResult {
    pub shown: bool,
}

#[tauri::command(rename_all = "camelCase")]
pub fn shell_context_menu_show_image(
    app: AppHandle,
    request: ShowArticleContextMenuRequest,
    state: State<'_, ImageContextMenuState>,
) -> Result<ImageContextMenuResult, String> {
    show_article_context_menu(&app, &state, request)
}

fn show_article_context_menu(
    app: &AppHandle,
    state: &ImageContextMenuState,
    request: ShowArticleContextMenuRequest,
) -> Result<ImageContextMenuResult, String> {
    let trimmed = request.url.trim();
    if trimmed.is_empty() {
        return Ok(ImageContextMenuResult { shown: false });
    }

    let kind = ArticleContextMenuKind::from_request(request.kind.trim())
        .ok_or_else(|| format!("Unsupported article context menu kind: {}", request.kind))?;

    let window = resolve_context_menu_window(app, request.window_label.as_deref())?;

    {
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "Failed to lock the article context menu state.".to_string())?;
        *pending = Some(PendingArticleContextMenu {
            url: trimmed.to_string(),
        });
    }

    let menu = build_article_context_menu(app, kind)?;
    window
        .popup_menu(&menu)
        .map_err(|error| format!("Failed to show the article context menu: {error}"))?;

    Ok(ImageContextMenuResult { shown: true })
}

fn resolve_context_menu_window(
    app: &AppHandle,
    window_label: Option<&str>,
) -> Result<tauri::WebviewWindow, String> {
    if let Some(label) = window_label {
        if let Some(window) = app.get_webview_window(label) {
            return Ok(window);
        }
    }

    app.get_webview_window("main")
        .or_else(|| app.get_webview_window("article"))
        .ok_or_else(|| "No active window is available for the article context menu.".to_string())
}

fn build_article_context_menu(app: &AppHandle, kind: ArticleContextMenuKind) -> Result<Menu<Wry>, String> {
    match kind {
        ArticleContextMenuKind::Link => {
            let open_item = menu_item(app, MENU_OPEN_LINK, "Open Link in Browser")?;
            let copy_item = menu_item(app, MENU_COPY_LINK, "Copy Link Address")?;
            Menu::with_items(app, &[&open_item, &copy_item])
                .map_err(menu_error)
        }
        ArticleContextMenuKind::Image => {
            let open_item = menu_item(app, MENU_OPEN_IMAGE, "Open Image in Browser")?;
            let copy_item = menu_item(app, MENU_COPY_IMAGE, "Copy Image Address")?;
            let download_item = menu_item(app, MENU_DOWNLOAD_IMAGE, "Download Image")?;
            Menu::with_items(app, &[&open_item, &copy_item, &download_item]).map_err(menu_error)
        }
    }
}

fn menu_item(app: &AppHandle, id: &str, label: &str) -> Result<MenuItem<Wry>, String> {
    MenuItem::with_id(app, id, label, true, None::<&str>).map_err(menu_error)
}

fn menu_error(error: tauri::Error) -> String {
    format!("Failed to build the article context menu: {error}")
}

async fn download_image_to_file(url: &str) -> Result<(), String> {
    validate_download_url(url)?;

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| format!("Failed to create HTTP client: {error}"))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Failed to download image: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download image: HTTP {}",
            response.status().as_u16()
        ));
    }

    if let Some(content_length) = response.content_length() {
        if content_length > MAX_IMAGE_DOWNLOAD_BYTES {
            return Err("Image is too large to download.".to_string());
        }
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Failed to read downloaded image: {error}"))?;

    if bytes.len() as u64 > MAX_IMAGE_DOWNLOAD_BYTES {
        return Err("Image is too large to download.".to_string());
    }

    let default_name = default_download_file_name(url, &content_type);
    let dialog = rfd::FileDialog::new()
        .set_title("Save Image")
        .set_file_name(&default_name)
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);

    let Some(path) = dialog.save_file() else {
        return Ok(());
    };

    std::fs::write(&path, &bytes)
        .map_err(|error| format!("Failed to write downloaded image: {error}"))
}

fn validate_download_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|error| format!("Invalid image URL: {error}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        scheme => Err(format!("Unsupported image URL scheme: {scheme}")),
    }
}

fn default_download_file_name(url: &str, content_type: &str) -> String {
    if let Ok(parsed) = reqwest::Url::parse(url) {
        if let Some(segment) = parsed
            .path_segments()
            .and_then(|segments| segments.last())
            .filter(|segment| !segment.is_empty())
            .filter(|segment| has_image_file_extension(segment))
        {
            return segment.to_string();
        }
    }

    match content_type {
        value if value.contains("png") => "image.png".to_string(),
        value if value.contains("gif") => "image.gif".to_string(),
        value if value.contains("webp") => "image.webp".to_string(),
        value if value.contains("svg") => "image.svg".to_string(),
        _ => "image.jpg".to_string(),
    }
}

fn has_image_file_extension(file_name: &str) -> bool {
    let lower = file_name.to_ascii_lowercase();
    [
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico", ".avif",
    ]
    .iter()
    .any(|extension| lower.ends_with(extension))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_article_context_menu_kinds() {
        assert_eq!(
            ArticleContextMenuKind::from_request("link"),
            Some(ArticleContextMenuKind::Link)
        );
        assert_eq!(
            ArticleContextMenuKind::from_request("image"),
            Some(ArticleContextMenuKind::Image)
        );
        assert!(ArticleContextMenuKind::from_request("other").is_none());
    }

    #[test]
    fn builds_default_download_name_from_url() {
        assert_eq!(
            default_download_file_name("https://example.com/photos/cat.png", "image/png"),
            "cat.png"
        );
        assert_eq!(
            default_download_file_name("https://example.com/photo", "image/jpeg"),
            "image.jpg"
        );
    }
}
