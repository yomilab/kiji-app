mod context_menu;
mod menu;
mod share;
mod window;
mod window_guards;

pub use context_menu::{shell_context_menu_show_image, ImageContextMenuState};
pub use menu::{shell_menu_update_state, ApplicationMenu};
pub use share::{shell_share, shell_share_list_services, shell_share_to_service};
pub use window::{
    restore_main_window_bounds, shell_article_window_get_data, shell_article_window_open,
    shell_main_window_apply_saved_bounds, shell_settings_window_open, ArticleWindowState,
};
pub use window_guards::init as window_guards_plugin;

use rfd::{FileDialog, MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogResult {
    pub canceled: bool,
    pub file_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPickResult {
    pub canceled: bool,
    pub folder_path: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn shell_links_open_external(app: AppHandle, url: String) -> Result<(), String> {
    validate_external_url(&url)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| format!("Failed to open external URL: {error}"))
}

#[tauri::command(rename_all = "camelCase")]
pub fn shell_dialog_open_file(
    title: Option<String>,
    default_path: Option<String>,
    filters: Option<Vec<FileFilter>>,
) -> Result<DialogResult, String> {
    let dialog = apply_open_options(FileDialog::new(), title, default_path, filters)?;
    let file_path = dialog.pick_file().map(path_to_string).transpose()?;

    Ok(DialogResult {
        canceled: file_path.is_none(),
        file_path,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn shell_file_read_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|error| format!("Failed to read text file: {error}"))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTextFileRequest {
    pub path: String,
    pub content: String,
}

#[tauri::command(rename_all = "camelCase")]
pub fn shell_file_write_text(request: WriteTextFileRequest) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(&request.path).parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create directory for text file: {error}"))?;
    }

    fs::write(&request.path, request.content)
        .map_err(|error| format!("Failed to write text file: {error}"))
}

#[tauri::command(rename_all = "camelCase")]
pub fn shell_dialog_save_file(
    title: Option<String>,
    default_path: Option<String>,
    file_name: Option<String>,
    filters: Option<Vec<FileFilter>>,
) -> Result<DialogResult, String> {
    let dialog = apply_save_options(FileDialog::new(), title, default_path, file_name, filters)?;
    let file_path = dialog.save_file().map(path_to_string).transpose()?;

    Ok(DialogResult {
        canceled: file_path.is_none(),
        file_path,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmDialogRequest {
    pub title: Option<String>,
    pub message: String,
}

#[tauri::command(rename_all = "camelCase")]
pub fn shell_dialog_confirm(request: ConfirmDialogRequest) -> Result<bool, String> {
    if request.message.trim().is_empty() {
        return Err("Confirm dialog message cannot be empty.".to_string());
    }

    let title = request
        .title
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "KiJi".to_string());

    let confirmed = MessageDialog::new()
        .set_level(MessageLevel::Warning)
        .set_title(title)
        .set_description(request.message)
        .set_buttons(MessageButtons::OkCancel)
        .show();

    Ok(matches!(confirmed, MessageDialogResult::Ok))
}

#[tauri::command(rename_all = "camelCase")]
pub fn shell_dialog_pick_folder(
    title: Option<String>,
    default_path: Option<String>,
) -> Result<FolderPickResult, String> {
    let mut dialog = FileDialog::new();
    if let Some(title) = title {
        dialog = dialog.set_title(title);
    }
    if let Some(default_path) = default_path {
        dialog = dialog.set_directory(default_path);
    }

    let folder_path = dialog.pick_folder().map(path_to_string).transpose()?;

    Ok(FolderPickResult {
        canceled: folder_path.is_none(),
        folder_path,
    })
}

fn apply_open_options(
    mut dialog: FileDialog,
    title: Option<String>,
    default_path: Option<String>,
    filters: Option<Vec<FileFilter>>,
) -> Result<FileDialog, String> {
    if let Some(title) = title {
        dialog = dialog.set_title(title);
    }
    if let Some(default_path) = default_path {
        dialog = dialog.set_directory(default_path);
    }
    apply_filters(dialog, filters)
}

fn apply_save_options(
    mut dialog: FileDialog,
    title: Option<String>,
    default_path: Option<String>,
    file_name: Option<String>,
    filters: Option<Vec<FileFilter>>,
) -> Result<FileDialog, String> {
    if let Some(title) = title {
        dialog = dialog.set_title(title);
    }
    if let Some(default_path) = default_path {
        dialog = dialog.set_directory(default_path);
    }
    if let Some(file_name) = file_name {
        dialog = dialog.set_file_name(file_name);
    }
    apply_filters(dialog, filters)
}

fn apply_filters(
    mut dialog: FileDialog,
    filters: Option<Vec<FileFilter>>,
) -> Result<FileDialog, String> {
    for filter in filters.unwrap_or_default() {
        if filter.name.trim().is_empty() {
            return Err("Dialog filter name cannot be empty.".to_string());
        }
        if filter
            .extensions
            .iter()
            .any(|extension| extension.trim().is_empty())
        {
            return Err("Dialog filter extensions cannot be empty.".to_string());
        }
        let extensions = filter
            .extensions
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        dialog = dialog.add_filter(filter.name, &extensions);
    }
    Ok(dialog)
}

fn path_to_string(path: PathBuf) -> Result<String, String> {
    path.into_os_string()
        .into_string()
        .map_err(|_| "Selected path is not valid UTF-8.".to_string())
}

fn validate_external_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|error| format!("Invalid URL: {error}"))?;
    match parsed.scheme() {
        "http" | "https" | "mailto" => Ok(()),
        scheme => Err(format!("Unsupported external URL scheme: {scheme}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_url_policy_allows_web_and_mailto_only() {
        assert!(validate_external_url("https://example.com").is_ok());
        assert!(validate_external_url("mailto:hello@example.com").is_ok());
        assert!(validate_external_url("file:///tmp/example").is_err());
    }
}
