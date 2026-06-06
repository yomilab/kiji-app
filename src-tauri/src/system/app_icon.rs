use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::ImageReader;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, image::Image, State};

const APP_ICON_STATE_FILE: &str = "app-icon-state.json";
const CUSTOM_ICON_BASENAME: &str = "custom-app-icon";

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SystemAppIconVariant {
    Light,
    Dark,
}

impl Default for SystemAppIconVariant {
    fn default() -> Self {
        Self::Dark
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemAppIconState {
    pub icon_path: Option<String>,
    pub preview_data_url: Option<String>,
    pub has_custom_icon: bool,
    pub icon_variant: SystemAppIconVariant,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoredAppIconState {
    icon_path: Option<String>,
    icon_variant: SystemAppIconVariant,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickSystemAppIconResult {
    pub canceled: bool,
    pub state: SystemAppIconState,
}

pub struct AppIconState {
    path: PathBuf,
    appearance_dir: PathBuf,
}

impl AppIconState {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let appearance_dir = resolve_appearance_dir(app)?;
        let path = appearance_dir.join(APP_ICON_STATE_FILE);
        Ok(Self {
            path,
            appearance_dir,
        })
    }

    fn read_stored(&self) -> Result<StoredAppIconState, String> {
        match fs::read_to_string(&self.path) {
            Ok(raw) => serde_json::from_str(&raw)
                .map_err(|error| format!("Failed to parse app icon state: {error}")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(StoredAppIconState::default())
            }
            Err(error) => Err(format!("Failed to read app icon state: {error}")),
        }
    }

    fn write_stored(&self, stored: &StoredAppIconState) -> Result<(), String> {
        let raw = serde_json::to_string_pretty(stored)
            .map_err(|error| format!("Failed to serialize app icon state: {error}"))?;
        fs::write(&self.path, raw)
            .map_err(|error| format!("Failed to write app icon state: {error}"))
    }

    pub fn get_state(&self, app: &AppHandle) -> Result<SystemAppIconState, String> {
        let stored = self.read_stored()?;
        build_public_state(app, &self.appearance_dir, stored)
    }

    pub fn set_variant(
        &self,
        app: &AppHandle,
        variant: SystemAppIconVariant,
    ) -> Result<SystemAppIconState, String> {
        let icon_path = resolve_built_in_icon_path(app, variant)?;
        apply_runtime_icon(app, &icon_path)?;
        self.clear_custom_icons(None)?;
        self.write_stored(&StoredAppIconState {
            icon_path: None,
            icon_variant: variant,
        })?;
        self.get_state(app)
    }

    pub fn pick_custom_icon(
        &self,
        app: &AppHandle,
        source_path: String,
    ) -> Result<SystemAppIconState, String> {
        let extension = validate_icon_extension(&source_path)?;
        let stored = self.read_stored()?;
        let destination_name = format!("{CUSTOM_ICON_BASENAME}{extension}");
        let destination_path = self.appearance_dir.join(&destination_name);

        fs::create_dir_all(&self.appearance_dir)
            .map_err(|error| format!("Failed to create appearance directory: {error}"))?;
        fs::copy(&source_path, &destination_path)
            .map_err(|error| format!("Failed to copy the selected app icon: {error}"))?;

        apply_runtime_icon(app, &destination_path)?;
        self.clear_custom_icons(Some(destination_name.as_str()))?;
        self.write_stored(&StoredAppIconState {
            icon_path: Some(path_to_string(&destination_path)?),
            icon_variant: stored.icon_variant,
        })?;
        self.get_state(app)
    }

    pub fn reset(&self, app: &AppHandle) -> Result<SystemAppIconState, String> {
        let stored = self.read_stored()?;
        self.clear_custom_icons(None)?;
        let icon_path = resolve_built_in_icon_path(app, stored.icon_variant)?;
        apply_runtime_icon(app, &icon_path)?;
        self.write_stored(&StoredAppIconState {
            icon_path: None,
            icon_variant: stored.icon_variant,
        })?;
        self.get_state(app)
    }

    pub fn apply_configured_icon(&self, app: &AppHandle) -> Result<(), String> {
        let stored = self.read_stored()?;
        let icon_path = stored
            .icon_path
            .as_deref()
            .map(PathBuf::from)
            .filter(|path| path.exists())
            .or_else(|| resolve_built_in_icon_path(app, stored.icon_variant).ok());

        let Some(icon_path) = icon_path else {
            return Ok(());
        };

        apply_runtime_icon(app, &icon_path)
    }

    fn clear_custom_icons(&self, preserved_file_name: Option<&str>) -> Result<(), String> {
        let entries = match fs::read_dir(&self.appearance_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(format!("Failed to read appearance directory: {error}")),
        };

        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();
            if file_name.starts_with(CUSTOM_ICON_BASENAME)
                && preserved_file_name.is_none_or(|preserved| file_name != preserved)
            {
                let _ = fs::remove_file(entry.path());
            }
        }

        Ok(())
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn system_app_icon_get_state(
    app: AppHandle,
    state: State<'_, AppIconState>,
) -> Result<SystemAppIconState, String> {
    state.get_state(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub fn system_app_icon_set_variant(
    app: AppHandle,
    variant: SystemAppIconVariant,
    state: State<'_, AppIconState>,
) -> Result<SystemAppIconState, String> {
    state.set_variant(&app, variant)
}

#[tauri::command(rename_all = "camelCase")]
pub fn system_app_icon_reset(
    app: AppHandle,
    state: State<'_, AppIconState>,
) -> Result<SystemAppIconState, String> {
    state.reset(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub fn system_app_icon_pick(
    app: AppHandle,
    state: State<'_, AppIconState>,
) -> Result<PickSystemAppIconResult, String> {
    let dialog_result = crate::shell::shell_dialog_open_file(
        Some("Choose App Icon".into()),
        None,
        Some(vec![crate::shell::FileFilter {
            name: "Image Files".into(),
            extensions: vec![
                "png".into(),
                "jpg".into(),
                "jpeg".into(),
                "ico".into(),
                "icns".into(),
            ],
        }]),
    )?;

    if dialog_result.canceled || dialog_result.file_path.is_none() {
        return Ok(PickSystemAppIconResult {
            canceled: true,
            state: state.get_state(&app)?,
        });
    }

    let file_path = dialog_result.file_path.unwrap();
    let next_state = state.pick_custom_icon(&app, file_path)?;
    Ok(PickSystemAppIconResult {
        canceled: false,
        state: next_state,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn system_app_relaunch(app: AppHandle) {
    app.request_restart();
}

fn build_public_state(
    app: &AppHandle,
    appearance_dir: &Path,
    stored: StoredAppIconState,
) -> Result<SystemAppIconState, String> {
    let _ = appearance_dir;
    let icon_path = stored
        .icon_path
        .as_ref()
        .filter(|path| Path::new(path).exists())
        .cloned();

    let preview_source = icon_path
        .as_deref()
        .map(Path::new)
        .map(|path| path.to_path_buf())
        .or_else(|| resolve_built_in_icon_path(app, stored.icon_variant).ok());

    Ok(SystemAppIconState {
        icon_path: icon_path.clone(),
        preview_data_url: preview_source
            .as_deref()
            .and_then(|path| create_preview_data_url(path).ok()),
        has_custom_icon: icon_path.is_some(),
        icon_variant: stored.icon_variant,
    })
}

fn resolve_appearance_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    let appearance_dir = data_dir.join("appearance");
    fs::create_dir_all(&appearance_dir)
        .map_err(|error| format!("Failed to create appearance directory: {error}"))?;
    Ok(appearance_dir)
}

fn resolve_built_in_icon_path(
    app: &AppHandle,
    variant: SystemAppIconVariant,
) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Failed to resolve resource directory: {error}"))?;

    let folder = match variant {
        SystemAppIconVariant::Light => "icons",
        SystemAppIconVariant::Dark => "icons-dark",
    };

    let file_name = if cfg!(target_os = "macos") {
        "icon.icns"
    } else if cfg!(target_os = "windows") {
        "icon.ico"
    } else {
        "icon.png"
    };

    let candidate = resource_dir.join(folder).join(file_name);
    if candidate.exists() {
        return Ok(candidate);
    }

    let fallback = resource_dir.join("icons").join(file_name);
    if fallback.exists() {
        return Ok(fallback);
    }

    Err(format!("Built-in {variant:?} app icon asset is missing."))
}

fn validate_icon_extension(source_path: &str) -> Result<String, String> {
    let extension = Path::new(source_path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .ok_or_else(|| "Choose a PNG, JPG, ICO, or ICNS file.".to_string())?;

    let normalized = format!(".{extension}");
    if !matches!(
        normalized.as_str(),
        ".png" | ".jpg" | ".jpeg" | ".ico" | ".icns"
    ) {
        return Err("Choose a PNG, JPG, ICO, or ICNS file.".to_string());
    }

    if extension == "icns" && !cfg!(target_os = "macos") {
        return Err("ICNS files are only supported on macOS.".to_string());
    }

    if extension == "ico" && !cfg!(target_os = "windows") {
        return Err("ICO files are only supported on Windows.".to_string());
    }

    Ok(normalized)
}

fn apply_runtime_icon(app: &AppHandle, icon_path: &Path) -> Result<(), String> {
    if cfg!(target_os = "macos")
        && icon_path.extension().and_then(|value| value.to_str()) == Some("icns")
    {
        return Ok(());
    }

    let image = ImageReader::open(icon_path)
        .map_err(|error| format!("Failed to open app icon image: {error}"))?
        .decode()
        .map_err(|error| format!("Failed to decode app icon image: {error}"))?;

    let rgba = image.to_rgba8();
    let (width, height) = rgba.dimensions();
    let bytes = rgba.into_raw();
    let icon = Image::new(&bytes, width, height);

    for label in ["main", "settings", "article"] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .set_icon(icon.clone())
                .map_err(|error| format!("Failed to apply app icon to {label}: {error}"))?;
        }
    }

    Ok(())
}

fn create_preview_data_url(icon_path: &Path) -> Result<String, String> {
    let extension = icon_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if extension == "icns" || extension == "ico" {
        return Err("Preview is unavailable for this icon format.".to_string());
    }

    let image = ImageReader::open(icon_path)
        .map_err(|error| format!("Failed to open icon preview: {error}"))?
        .decode()
        .map_err(|error| format!("Failed to decode icon preview: {error}"))?;

    let mut buffer = Cursor::new(Vec::new());
    image
        .write_to(&mut buffer, image::ImageFormat::Png)
        .map_err(|error| format!("Failed to encode icon preview: {error}"))?;

    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(buffer.into_inner())
    ))
}

fn path_to_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| "Selected path is not valid UTF-8.".to_string())
}
