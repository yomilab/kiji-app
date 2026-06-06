use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime},
};
use tauri::Manager;

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
pub struct ProcessSnapshot {
    pub pid: u32,
    #[serde(rename = "type")]
    pub process_type: String,
    pub cpu: f64,
    #[serde(rename = "mem")]
    pub memory_mb: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MainProcessSnapshot {
    pub pid: u32,
    pub rss_mb: f64,
    pub heap_used_mb: f64,
    pub heap_total_mb: f64,
    pub external_mb: f64,
    pub handles: u32,
    pub requests: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSnapshot {
    pub timestamp: String,
    pub processes: Vec<ProcessSnapshot>,
    pub main: MainProcessSnapshot,
}

pub struct DiagnosticsState {
    logs_dir: PathBuf,
    recent_entries: Mutex<Vec<LogEntry>>,
}

impl DiagnosticsState {
    pub fn load(app: &tauri::AppHandle) -> Result<Self, String> {
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

    pub(crate) fn logs_dir(&self) -> &Path {
        &self.logs_dir
    }

    fn logs_path(&self) -> String {
        self.logs_dir.to_string_lossy().to_string()
    }

    pub fn log(&self, entry_input: LogEntryInput) -> Result<(), String> {
        let entry = normalize_log_entry(entry_input)?;
        self.persist_entry(&entry)
    }

    pub(crate) fn log_internal(&self, payload: JsonValue) -> Result<(), String> {
        let entry = normalize_log_entry(LogEntryInput {
            level: payload
                .get("level")
                .and_then(JsonValue::as_str)
                .unwrap_or("info")
                .to_string(),
            process: payload
                .get("process")
                .and_then(JsonValue::as_str)
                .unwrap_or("native")
                .to_string(),
            category: payload
                .get("category")
                .and_then(JsonValue::as_str)
                .unwrap_or("Diagnostics")
                .to_string(),
            message: payload
                .get("message")
                .and_then(JsonValue::as_str)
                .unwrap_or("Diagnostics event")
                .to_string(),
            event: payload
                .get("event")
                .and_then(JsonValue::as_str)
                .map(str::to_string),
            context: payload.get("context").cloned(),
            error: payload.get("error").cloned(),
            timestamp: None,
        })?;
        self.persist_entry(&entry)
    }

    fn persist_entry(&self, entry: &LogEntry) -> Result<(), String> {
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
        let formatted = format_entry(entry);

        if entry.level != "debug" {
            append_log(
                &self.logs_dir.join(format!("app-{log_date}.log")),
                &formatted,
            )?;
        }
        if entry.level == "warn" || entry.level == "error" {
            append_log(
                &self.logs_dir.join(format!("error-{log_date}.log")),
                &formatted,
            )?;
        }
        append_log(
            &self.logs_dir.join(format!("debug-{log_date}.log")),
            &formatted,
        )?;

        Ok(())
    }

    pub fn recent_entries(&self) -> Result<Vec<LogEntry>, String> {
        self.recent_entries
            .lock()
            .map(|entries| entries.clone())
            .map_err(|_| "Failed to lock diagnostics recent entries.".to_string())
    }
}

#[tauri::command]
pub fn diagnostics_log_write_entry(
    entry: LogEntryInput,
    state: tauri::State<'_, std::sync::Arc<DiagnosticsState>>,
) -> Result<(), String> {
    state.log(entry)
}

#[tauri::command]
pub fn diagnostics_log_get_path(
    state: tauri::State<'_, std::sync::Arc<DiagnosticsState>>,
) -> Result<String, String> {
    Ok(state.logs_path())
}

pub fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
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
            context: Some(serde_json::json!({ "id": 1 })),
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
