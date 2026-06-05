use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Manager, State};

const LOG_RETENTION_DAYS: u64 = 2;
const MAX_RECENT_ENTRIES: usize = 500;
const MS_PER_DAY: u64 = 24 * 60 * 60 * 1000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntryInput {
    pub level: String,
    pub process: String,
    pub category: String,
    pub message: String,
    pub event: Option<String>,
    pub context: Option<JsonValue>,
    pub error: Option<JsonValue>,
    pub timestamp: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub process: String,
    pub category: String,
    pub message: String,
    pub event: Option<String>,
    pub context: Option<JsonValue>,
    pub error: Option<JsonValue>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessSnapshot {
    pub pid: u32,
    #[serde(rename = "type")]
    pub process_type: String,
    pub cpu: f64,
    pub memory_mb: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSnapshot {
    pub pid: u32,
    pub rss_mb: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSnapshot {
    pub timestamp: String,
    pub processes: Vec<ProcessSnapshot>,
    pub native: NativeSnapshot,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsExportResponse {
    pub file_path: String,
}

pub struct DiagnosticsState {
    logs_dir: PathBuf,
    recent_entries: Mutex<Vec<LogEntry>>,
}

impl DiagnosticsState {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let logs_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Failed to resolve app data directory: {error}"))?
            .join("logs");
        fs::create_dir_all(&logs_dir)
            .map_err(|error| format!("Failed to create logs directory: {error}"))?;
        cleanup_old_logs(&logs_dir)?;

        Ok(Self {
            logs_dir,
            recent_entries: Mutex::new(Vec::new()),
        })
    }

    fn logs_path(&self) -> String {
        self.logs_dir.to_string_lossy().to_string()
    }

    fn log(&self, entry_input: LogEntryInput) -> Result<(), String> {
        let entry = normalize_log_entry(entry_input)?;
        {
            let mut recent_entries = self
                .recent_entries
                .lock()
                .map_err(|_| "Failed to lock diagnostics recent entries.".to_string())?;
            recent_entries.push(entry.clone());
            if recent_entries.len() > MAX_RECENT_ENTRIES {
                recent_entries.remove(0);
            }
        }

        let log_date = entry.timestamp.get(0..10).unwrap_or("unknown");
        let formatted = format_entry(&entry);

        if entry.level != "debug" {
            append_log(&self.logs_dir.join(format!("app-{log_date}.log")), &formatted)?;
        }
        if entry.level == "warn" || entry.level == "error" {
            append_log(&self.logs_dir.join(format!("error-{log_date}.log")), &formatted)?;
        }
        append_log(&self.logs_dir.join(format!("debug-{log_date}.log")), &formatted)?;

        Ok(())
    }

    fn export_bundle(&self) -> Result<DiagnosticsExportResponse, String> {
        let timestamp = timestamp().replace([':', '.'], "-");
        let file_path = self.logs_dir.join(format!("kiji-error-report-{timestamp}.json"));
        let recent_entries = self
            .recent_entries
            .lock()
            .map_err(|_| "Failed to lock diagnostics recent entries.".to_string())?
            .clone();
        let log_files = collect_recent_log_files(&self.logs_dir)?;
        let payload = json!({
            "generatedAt": timestamp,
            "logsDir": self.logs_path(),
            "performance": performance_snapshot(),
            "recentEntries": recent_entries,
            "logFiles": log_files,
        });

        fs::write(
            &file_path,
            serde_json::to_string_pretty(&payload)
                .map_err(|error| format!("Failed to encode diagnostics export: {error}"))?,
        )
        .map_err(|error| format!("Failed to write diagnostics export: {error}"))?;

        Ok(DiagnosticsExportResponse {
            file_path: file_path.to_string_lossy().to_string(),
        })
    }
}

#[tauri::command]
pub fn diagnostics_log_write_entry(
    entry: LogEntryInput,
    state: State<'_, DiagnosticsState>,
) -> Result<(), String> {
    state.log(entry)
}

#[tauri::command]
pub fn diagnostics_log_get_path(state: State<'_, DiagnosticsState>) -> Result<String, String> {
    Ok(state.logs_path())
}

#[tauri::command]
pub fn diagnostics_performance_snapshot() -> Result<PerformanceSnapshot, String> {
    Ok(performance_snapshot())
}

#[tauri::command]
pub fn diagnostics_export_bundle(
    state: State<'_, DiagnosticsState>,
) -> Result<DiagnosticsExportResponse, String> {
    state.export_bundle()
}

fn normalize_log_entry(entry: LogEntryInput) -> Result<LogEntry, String> {
    match entry.level.as_str() {
        "debug" | "info" | "warn" | "error" => {}
        level => return Err(format!("Unsupported log level: {level}")),
    }
    if entry.category.trim().is_empty() {
        return Err("Log category cannot be empty.".to_string());
    }
    if entry.message.trim().is_empty() {
        return Err("Log message cannot be empty.".to_string());
    }

    Ok(LogEntry {
        timestamp: entry.timestamp.unwrap_or_else(timestamp),
        level: entry.level,
        process: entry.process,
        category: entry.category,
        message: entry.message,
        event: entry.event,
        context: entry.context,
        error: entry.error,
    })
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn append_log(path: &Path, formatted: &str) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("Failed to open log file: {error}"))?;
    file.write_all(formatted.as_bytes())
        .map_err(|error| format!("Failed to append log file: {error}"))
}

fn format_entry(entry: &LogEntry) -> String {
    let mut line = format!(
        "[{}] [{}] [{}] [{}]",
        entry.timestamp,
        entry.level.to_uppercase(),
        entry.process,
        entry.category
    );
    if let Some(event) = &entry.event {
        line.push_str(&format!(" [{event}]"));
    }
    line.push_str(&format!(" {}", entry.message));

    let mut details = Vec::new();
    if let Some(context) = &entry.context {
        details.push(format!("context={context}"));
    }
    if let Some(error) = &entry.error {
        details.push(format!("error={error}"));
    }

    if details.is_empty() {
        format!("{line}\n")
    } else {
        format!("{line}\n{}\n", details.join("\n"))
    }
}

fn cleanup_old_logs(logs_dir: &Path) -> Result<(), String> {
    let threshold = SystemTime::now()
        .checked_sub(Duration::from_millis(LOG_RETENTION_DAYS * MS_PER_DAY))
        .unwrap_or(SystemTime::UNIX_EPOCH);

    for entry in fs::read_dir(logs_dir).map_err(|error| format!("Failed to read logs: {error}"))? {
        let entry = entry.map_err(|error| format!("Failed to inspect log entry: {error}"))?;
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("log") {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|error| format!("Failed to read log metadata: {error}"))?;
        let modified = metadata.modified().unwrap_or(SystemTime::now());
        if modified < threshold {
            let _ = fs::remove_file(path);
        }
    }

    Ok(())
}

fn collect_recent_log_files(logs_dir: &Path) -> Result<Vec<JsonValue>, String> {
    let mut files = fs::read_dir(logs_dir)
        .map_err(|error| format!("Failed to read logs directory: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().and_then(|extension| extension.to_str()) == Some("log"))
        .collect::<Vec<_>>();
    files.sort_by_key(|entry| entry.file_name());
    files.truncate(20);

    files
        .into_iter()
        .map(|entry| {
            let file_name = entry.file_name().to_string_lossy().to_string();
            let contents = fs::read_to_string(entry.path())
                .map_err(|error| format!("Failed to read log file {file_name}: {error}"))?;
            Ok(json!({ "fileName": file_name, "contents": contents }))
        })
        .collect()
}

fn performance_snapshot() -> PerformanceSnapshot {
    let pid = std::process::id();
    PerformanceSnapshot {
        timestamp: timestamp(),
        processes: vec![ProcessSnapshot {
            pid,
            process_type: "native".to_string(),
            cpu: 0.0,
            memory_mb: 0.0,
        }],
        native: NativeSnapshot { pid, rss_mb: 0.0 },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_valid_log_entry() {
        let entry = normalize_log_entry(LogEntryInput {
            level: "error".to_string(),
            process: "renderer".to_string(),
            category: "Test".to_string(),
            message: "Something failed".to_string(),
            event: Some("unit".to_string()),
            context: Some(json!({ "id": 1 })),
            error: None,
            timestamp: None,
        })
        .expect("entry is valid");

        assert_eq!(entry.level, "error");
        assert_eq!(entry.category, "Test");
        assert!(entry.timestamp.contains('T'));
    }

    #[test]
    fn rejects_invalid_log_entry() {
        let error = normalize_log_entry(LogEntryInput {
            level: "trace".to_string(),
            process: "renderer".to_string(),
            category: "Test".to_string(),
            message: "Something failed".to_string(),
            event: None,
            context: None,
            error: None,
            timestamp: None,
        })
        .expect_err("trace is unsupported");

        assert!(error.contains("Unsupported log level"));
    }
}
