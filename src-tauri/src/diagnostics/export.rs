use super::snapshot::capture_performance_snapshot;
use super::state::{timestamp, DiagnosticsState};
use crate::settings::{AppSettings, SettingsState};
use rfd::FileDialog;
use serde::Serialize;
use serde_json::json;
use std::{
    fs::{self, File},
    io::Write,
    sync::Arc,
};
use tauri::State;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

const EXPORT_FILE_PREFIX: &str = "kiji-error-report";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsExportResponse {
    pub canceled: bool,
    pub file_path: Option<String>,
}

#[tauri::command]
pub fn diagnostics_export_bundle(
    state: State<'_, Arc<DiagnosticsState>>,
    settings_state: State<'_, Arc<SettingsState>>,
) -> Result<DiagnosticsExportResponse, String> {
    let export_timestamp = timestamp().replace([':', '.'], "-");
    let default_name = format!("{EXPORT_FILE_PREFIX}-{export_timestamp}.zip");
    let save_path = FileDialog::new()
        .set_title("Export Error Report")
        .set_file_name(default_name)
        .add_filter("ZIP Files", &["zip"])
        .save_file();

    let Some(save_path) = save_path else {
        return Ok(DiagnosticsExportResponse {
            canceled: true,
            file_path: None,
        });
    };

    let recent_entries = state.recent_entries()?;
    let settings = settings_state.snapshot()?;
    write_zip_export(&save_path, state.logs_dir(), &recent_entries, &settings)?;

    let _ = state.log_internal(json!({
        "level": "info",
        "process": "native",
        "category": "Diagnostics",
        "event": "export-success",
        "message": "Exported diagnostics bundle",
        "context": {
            "filePath": save_path.to_string_lossy(),
        },
    }));

    Ok(DiagnosticsExportResponse {
        canceled: false,
        file_path: Some(save_path.to_string_lossy().to_string()),
    })
}

fn write_zip_export(
    save_path: &std::path::Path,
    logs_dir: &std::path::Path,
    recent_entries: &[super::state::LogEntry],
    settings: &AppSettings,
) -> Result<(), String> {
    let file = File::create(save_path)
        .map_err(|error| format!("Failed to create diagnostics export file: {error}"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default();

    for entry in collect_recent_log_files(logs_dir)? {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        let contents = fs::read_to_string(&path)
            .map_err(|error| format!("Failed to read log file {file_name}: {error}"))?;
        zip.start_file(format!("logs/{file_name}"), options)
            .map_err(|error| format!("Failed to start ZIP entry for {file_name}: {error}"))?;
        zip.write_all(contents.as_bytes())
            .map_err(|error| format!("Failed to write ZIP entry for {file_name}: {error}"))?;
    }

    let metadata = json!({
        "generatedAt": timestamp(),
        "appVersion": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "settings": {
            "theme": settings.theme,
            "backgroundUpdate": settings.background_update,
            "windowSize": settings.window_size,
        },
        "performance": capture_performance_snapshot(),
    });
    write_json_entry(&mut zip, "metadata.json", &metadata, options)?;

    let recent_payload = json!(recent_entries.iter().rev().take(200).collect::<Vec<_>>());
    write_json_entry(
        &mut zip,
        "recent-log-entries.json",
        &recent_payload,
        options,
    )?;

    zip.finish()
        .map_err(|error| format!("Failed to finalize diagnostics export ZIP: {error}"))?;
    Ok(())
}

fn write_json_entry(
    zip: &mut ZipWriter<File>,
    name: &str,
    payload: &serde_json::Value,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(payload)
        .map_err(|error| format!("Failed to encode {name}: {error}"))?;
    zip.start_file(name, options)
        .map_err(|error| format!("Failed to start ZIP entry for {name}: {error}"))?;
    zip.write_all(raw.as_bytes())
        .map_err(|error| format!("Failed to write ZIP entry for {name}: {error}"))
}

fn collect_recent_log_files(logs_dir: &std::path::Path) -> Result<Vec<fs::DirEntry>, String> {
    let mut files = fs::read_dir(logs_dir)
        .map_err(|error| format!("Failed to read logs directory: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .path()
                .extension()
                .and_then(|extension| extension.to_str())
                == Some("log")
        })
        .collect::<Vec<_>>();
    files.sort_by_key(|entry| entry.file_name());
    files.truncate(20);
    Ok(files)
}
