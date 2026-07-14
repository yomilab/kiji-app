use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager, State};

const SETTINGS_FILE_NAME: &str = "user-settings.json";

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Theme {
    #[default]
    Auto,
    Light,
    Dark,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum LayoutType {
    #[default]
    #[serde(rename = "2-column")]
    TwoColumn,
    #[serde(rename = "3-column")]
    ThreeColumn,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum BackgroundUpdateMode {
    #[serde(rename = "on-launch")]
    OnLaunch,
    #[serde(rename = "every-5m")]
    Every5Minutes,
    #[serde(rename = "every-10m")]
    Every10Minutes,
    #[default]
    #[serde(rename = "every-15m")]
    Every15Minutes,
    #[serde(rename = "every-30m")]
    Every30Minutes,
    #[serde(rename = "every-1h")]
    EveryHour,
    #[serde(rename = "never")]
    Never,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum ContentParser {
    #[default]
    Defuddle,
    Readability,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowSize {
    pub width: u32,
    pub height: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<i32>,
}

impl Default for WindowSize {
    fn default() -> Self {
        Self {
            width: 800,
            height: 600,
            x: None,
            y: None,
        }
    }
}

impl WindowSize {
    fn apply_patch(&mut self, patch: WindowSizePatch) -> Result<(), String> {
        if let Some(width) = patch.width {
            validate_positive_dimension("windowSize.width", width)?;
            self.width = width;
        }

        if let Some(height) = patch.height {
            validate_positive_dimension("windowSize.height", height)?;
            self.height = height;
        }

        if let Some(x) = patch.x {
            self.x = Some(x);
        }

        if let Some(y) = patch.y {
            self.y = Some(y);
        }

        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub theme: Theme,
    pub layout: LayoutType,
    pub sidebar_width: u32,
    pub article_list_width: u32,
    pub window_size: WindowSize,
    pub background_update: BackgroundUpdateMode,
    pub content_parser: ContentParser,
    pub saved_articles_sync_folder: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: Theme::Auto,
            layout: LayoutType::TwoColumn,
            sidebar_width: 300,
            article_list_width: 350,
            window_size: WindowSize::default(),
            background_update: BackgroundUpdateMode::Every15Minutes,
            content_parser: ContentParser::Defuddle,
            saved_articles_sync_folder: None,
        }
    }
}

impl AppSettings {
    fn validate(&self) -> Result<(), String> {
        validate_positive_dimension("sidebarWidth", self.sidebar_width)?;
        validate_positive_dimension("articleListWidth", self.article_list_width)?;
        validate_positive_dimension("windowSize.width", self.window_size.width)?;
        validate_positive_dimension("windowSize.height", self.window_size.height)?;
        Ok(())
    }

    fn apply_patch(&mut self, patch: AppSettingsPatch) -> Result<(), String> {
        if let Some(theme) = patch.theme {
            self.theme = theme;
        }

        if let Some(layout) = patch.layout {
            self.layout = layout;
        }

        if let Some(sidebar_width) = patch.sidebar_width {
            validate_positive_dimension("sidebarWidth", sidebar_width)?;
            self.sidebar_width = sidebar_width;
        }

        if let Some(article_list_width) = patch.article_list_width {
            validate_positive_dimension("articleListWidth", article_list_width)?;
            self.article_list_width = article_list_width;
        }

        if let Some(window_size) = patch.window_size {
            self.window_size.apply_patch(window_size)?;
        }

        if let Some(background_update) = patch.background_update {
            self.background_update = background_update;
        }

        if let Some(content_parser) = patch.content_parser {
            self.content_parser = content_parser;
        }

        if let Some(saved_articles_sync_folder) = patch.saved_articles_sync_folder {
            self.saved_articles_sync_folder = normalize_optional_string(saved_articles_sync_folder);
        }

        Ok(())
    }
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowSizePatch {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub x: Option<i32>,
    pub y: Option<i32>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettingsPatch {
    pub theme: Option<Theme>,
    pub layout: Option<LayoutType>,
    pub sidebar_width: Option<u32>,
    pub article_list_width: Option<u32>,
    pub window_size: Option<WindowSizePatch>,
    pub background_update: Option<BackgroundUpdateMode>,
    pub content_parser: Option<ContentParser>,
    pub saved_articles_sync_folder: Option<Option<String>>,
}

pub struct SettingsState {
    path: PathBuf,
    settings: Mutex<AppSettings>,
}

impl SettingsState {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let path = resolve_settings_path(app)?;
        let raw = read_settings_file(&path)?;
        let settings = parse_settings_snapshot(raw.as_deref())?;

        // Only rewrite the file when its normalized form differs (missing
        // file, new fields, formatting drift); skip the disk write on the
        // common startup path.
        let serialized = serialize_settings(&settings)?;
        if raw.as_deref() != Some(serialized.as_str()) {
            fs::write(&path, &serialized)
                .map_err(|error| format!("Failed to write the settings file: {error}"))?;
        }

        Ok(Self {
            path,
            settings: Mutex::new(settings),
        })
    }

    pub fn snapshot(&self) -> Result<AppSettings, String> {
        self.settings
            .lock()
            .map(|settings| settings.clone())
            .map_err(|_| "Failed to lock the settings state.".to_string())
    }

    fn update(&self, patch: AppSettingsPatch) -> Result<AppSettings, String> {
        let mut settings = self
            .settings
            .lock()
            .map_err(|_| "Failed to lock the settings state.".to_string())?;

        settings.apply_patch(patch)?;
        settings.validate()?;
        write_settings_snapshot(&self.path, &settings)?;

        Ok(settings.clone())
    }

    fn reset(&self) -> Result<AppSettings, String> {
        let mut settings = self
            .settings
            .lock()
            .map_err(|_| "Failed to lock the settings state.".to_string())?;

        *settings = AppSettings::default();
        write_settings_snapshot(&self.path, &settings)?;

        Ok(settings.clone())
    }

    pub fn update_window_bounds(
        &self,
        width: u32,
        height: u32,
        x: Option<i32>,
        y: Option<i32>,
    ) -> Result<(), String> {
        self.update(AppSettingsPatch {
            window_size: Some(WindowSizePatch {
                width: Some(width),
                height: Some(height),
                x,
                y,
            }),
            ..Default::default()
        })?;
        Ok(())
    }
}

#[tauri::command]
pub fn settings_get(state: State<'_, Arc<SettingsState>>) -> Result<AppSettings, String> {
    state.snapshot()
}

#[tauri::command]
pub fn settings_update(
    patch: AppSettingsPatch,
    state: State<'_, Arc<SettingsState>>,
    sync_state: State<'_, crate::saved::SavedSyncState>,
) -> Result<AppSettings, String> {
    let previous_folder = state.snapshot()?.saved_articles_sync_folder.clone();
    let updated = state.update(patch)?;
    if updated.saved_articles_sync_folder != previous_folder {
        sync_state.handle_settings_changed();
    }
    Ok(updated)
}

#[tauri::command]
pub fn settings_reset(state: State<'_, Arc<SettingsState>>) -> Result<AppSettings, String> {
    state.reset()
}

fn resolve_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Failed to resolve the app config directory: {error}"))?;

    fs::create_dir_all(&config_dir)
        .map_err(|error| format!("Failed to create the app config directory: {error}"))?;

    Ok(config_dir.join(SETTINGS_FILE_NAME))
}

fn read_settings_file(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(raw) => Ok(Some(raw)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Failed to read the settings file: {error}")),
    }
}

fn parse_settings_snapshot(raw: Option<&str>) -> Result<AppSettings, String> {
    match raw {
        Some(raw) => {
            let settings: AppSettings = serde_json::from_str(raw)
                .map_err(|error| format!("Failed to parse the settings file: {error}"))?;
            settings.validate()?;
            Ok(settings)
        }
        None => Ok(AppSettings::default()),
    }
}

fn serialize_settings(settings: &AppSettings) -> Result<String, String> {
    settings.validate()?;
    serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Failed to serialize settings: {error}"))
}

fn write_settings_snapshot(path: &Path, settings: &AppSettings) -> Result<(), String> {
    let raw = serialize_settings(settings)?;
    fs::write(path, raw).map_err(|error| format!("Failed to write the settings file: {error}"))
}

fn validate_positive_dimension(field_name: &str, value: u32) -> Result<(), String> {
    if value == 0 {
        return Err(format!("{field_name} must be greater than zero."));
    }

    Ok(())
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|candidate| {
        let trimmed = candidate.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_are_valid() {
        AppSettings::default()
            .validate()
            .expect("default settings should validate");
    }

    #[test]
    fn rejects_zero_sidebar_width_patch() {
        let mut settings = AppSettings::default();
        let patch = AppSettingsPatch {
            sidebar_width: Some(0),
            ..Default::default()
        };

        assert!(settings.apply_patch(patch).is_err());
    }

    #[test]
    fn normalizes_blank_sync_folder_to_none() {
        let mut settings = AppSettings::default();
        let patch = AppSettingsPatch {
            saved_articles_sync_folder: Some(Some("   ".to_string())),
            ..Default::default()
        };

        settings.apply_patch(patch).expect("patch should apply");
        assert_eq!(settings.saved_articles_sync_folder, None);
    }

    #[test]
    fn round_trips_json_snapshot() {
        let settings = AppSettings::default();
        let raw = serde_json::to_string(&settings).expect("serialize settings");
        let parsed: AppSettings = serde_json::from_str(&raw).expect("deserialize settings");

        parsed.validate().expect("round trip should validate");
        assert_eq!(parsed, settings);
    }

    #[test]
    fn round_trips_window_position_fields() {
        let settings = AppSettings {
            window_size: WindowSize {
                width: 1024,
                height: 768,
                x: Some(120),
                y: Some(80),
            },
            ..AppSettings::default()
        };

        let raw = serde_json::to_string(&settings).expect("serialize settings");
        let parsed: AppSettings = serde_json::from_str(&raw).expect("deserialize settings");

        assert_eq!(parsed.window_size.x, Some(120));
        assert_eq!(parsed.window_size.y, Some(80));
    }
}
