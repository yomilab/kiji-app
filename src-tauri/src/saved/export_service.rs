use std::{
    fs::{self, File},
    io::Write,
    path::Path,
    sync::{Arc, Mutex},
    thread,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::db::{get_saved_articles_page, DbState, SavedArticleRecord};

use super::export_format::{
    build_saved_articles_index_markdown, create_saved_article_markdown,
    create_saved_article_markdown_file_name, format_csv_value, SavedArticleIndexEntry,
};

const PAGE_SIZE: i64 = 200;
const ONE_GB_BYTES: u64 = 1024 * 1024 * 1024;
const ZIP_ESTIMATE_RATIO: f64 = 0.55;
const EXPORT_EVENT: &str = "saved-articles-export:event";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedArticlesExportPreflight {
    pub article_count: i64,
    pub estimated_uncompressed_bytes: i64,
    pub estimated_zip_bytes: i64,
    pub free_bytes: Option<u64>,
    pub exceeds_one_gb: bool,
    pub exceeds_free_space: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedArticlesExportStartResponse {
    pub started: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedArticlesExportCompletedPayload {
    output_path: String,
    article_count: i64,
    written_bytes: u64,
    duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedArticlesExportEventProgress {
    job_id: String,
    status: &'static str,
    phase: &'static str,
    article_count: i64,
    processed_articles: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    written_bytes: Option<u64>,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedArticlesExportEventCompleted {
    job_id: String,
    status: &'static str,
    message: String,
    result: SavedArticlesExportCompletedPayload,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedArticlesExportEventFailed {
    job_id: String,
    status: &'static str,
    message: String,
    error: String,
}

pub struct SavedExportState {
    active_job_id: Arc<Mutex<Option<String>>>,
}

impl SavedExportState {
    pub fn new() -> Self {
        Self {
            active_job_id: Arc::new(Mutex::new(None)),
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn saved_export_preflight(
    output_path: String,
    db_state: State<'_, DbState>,
) -> Result<SavedArticlesExportPreflight, String> {
    db_state.with_connection(|connection| build_preflight(connection, &output_path))
}

#[tauri::command(rename_all = "camelCase")]
pub fn saved_export_start(
    output_path: String,
    app: AppHandle,
    db_state: State<'_, DbState>,
    export_state: State<'_, SavedExportState>,
) -> Result<SavedArticlesExportStartResponse, String> {
    {
        let active_job = export_state
            .active_job_id
            .lock()
            .map_err(|_| "Failed to lock saved export state.".to_string())?;
        if active_job.is_some() {
            return Ok(SavedArticlesExportStartResponse {
                started: false,
                job_id: None,
                reason: Some("busy".to_string()),
            });
        }
    }

    let job_id = Uuid::new_v4().to_string();
    {
        let mut active_job = export_state
            .active_job_id
            .lock()
            .map_err(|_| "Failed to lock saved export state.".to_string())?;
        *active_job = Some(job_id.clone());
    }

    let db_path = db_state.database_path();
    let active_job_id = Arc::clone(&export_state.active_job_id);
    let worker_job_id = job_id.clone();

    thread::spawn(move || {
        let result = run_export_job(&app, &db_path, &output_path, &worker_job_id);
        if let Err(error) = result {
            let _ = app.emit(
                EXPORT_EVENT,
                SavedArticlesExportEventFailed {
                    job_id: worker_job_id.clone(),
                    status: "failed",
                    message: "Export failed".to_string(),
                    error,
                },
            );
        }

        if let Ok(mut active_job) = active_job_id.lock() {
            if active_job.as_deref() == Some(worker_job_id.as_str()) {
                *active_job = None;
            }
        }
    });

    Ok(SavedArticlesExportStartResponse {
        started: true,
        job_id: Some(job_id),
        reason: None,
    })
}

fn build_preflight(connection: &Connection, output_path: &str) -> Result<SavedArticlesExportPreflight, String> {
    let article_count = count_saved_articles(connection)?;
    let estimated_uncompressed_bytes = estimate_saved_articles_export_bytes(connection)?;
    let estimated_zip_bytes = std::cmp::max(
        (estimated_uncompressed_bytes as f64 * ZIP_ESTIMATE_RATIO).round() as i64,
        article_count * 512,
    );
    let free_bytes = get_free_bytes_for_path(output_path);
    let estimated_zip_bytes_u64 = u64::try_from(estimated_zip_bytes).unwrap_or(u64::MAX);

    Ok(SavedArticlesExportPreflight {
        article_count,
        estimated_uncompressed_bytes,
        estimated_zip_bytes,
        free_bytes,
        exceeds_one_gb: estimated_zip_bytes_u64 > ONE_GB_BYTES,
        exceeds_free_space: free_bytes
            .map(|available| estimated_zip_bytes_u64 > available)
            .unwrap_or(false),
    })
}

pub(crate) fn export_saved_articles_to_zip(
    connection: &Connection,
    output_path: &Path,
) -> Result<(i64, u64), String> {
    let article_count = count_saved_articles(connection)?;
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create export directory: {error}"))?;
    }

    let file = File::create(output_path)
        .map_err(|error| format!("Failed to create export archive: {error}"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let mut csv_body = String::from("title,url,time_added,tags\n");
    let mut used_names = std::collections::HashMap::new();
    let mut exported_index = Vec::<SavedArticleIndexEntry>::new();
    let mut offset = 0_i64;

    while offset < article_count {
        let rows = get_saved_articles_page(connection, PAGE_SIZE, offset)?;
        for row in rows {
            let (normalized_title, file_name) =
                create_saved_article_markdown_file_name(row.title.as_deref(), &mut used_names);
            let time_added = saved_article_time_added(&row);
            let tags = feed_tags_for_article(connection, row.feed_id.as_deref())?;
            csv_body.push_str(&format!(
                "{},{},{time_added},{}\n",
                format_csv_value(&normalized_title),
                format_csv_value(row.link.as_deref().unwrap_or("")),
                format_csv_value(&tags),
            ));

            let markdown = create_saved_article_markdown(&row);
            let archive_path = format!("articles/{file_name}");
            zip.start_file(&archive_path, options)
                .map_err(|error| format!("Failed to start ZIP entry: {error}"))?;
            zip.write_all(markdown.as_bytes())
                .map_err(|error| format!("Failed to write ZIP entry: {error}"))?;

            exported_index.push(SavedArticleIndexEntry {
                title: normalized_title,
                file_name,
            });
        }
        offset += PAGE_SIZE;
    }

    zip.start_file("pocket.csv", options)
        .map_err(|error| format!("Failed to start pocket.csv entry: {error}"))?;
    zip.write_all(csv_body.as_bytes())
        .map_err(|error| format!("Failed to write pocket.csv: {error}"))?;

    let index_markdown = build_saved_articles_index_markdown(&exported_index);
    zip.start_file("articles.md", options)
        .map_err(|error| format!("Failed to start articles.md entry: {error}"))?;
    zip.write_all(index_markdown.as_bytes())
        .map_err(|error| format!("Failed to write articles.md: {error}"))?;

    let written_bytes = zip
        .finish()
        .map_err(|error| format!("Failed to finalize export archive: {error}"))?
        .metadata()
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    Ok((article_count, written_bytes))
}

fn run_export_job(
    app: &AppHandle,
    db_path: &Path,
    output_path: &str,
    job_id: &str,
) -> Result<(), String> {
    let started_at = Instant::now();
    let connection = Connection::open(db_path)
        .map_err(|error| format!("Failed to open database for export: {error}"))?;

    let article_count = count_saved_articles(&connection)?;
    emit_progress(
        app,
        job_id,
        "starting",
        article_count,
        0,
        None,
        format!("Preparing export ({article_count})"),
    )?;

    let (article_count, written_bytes) =
        export_saved_articles_to_zip(&connection, Path::new(output_path))?;

    emit_progress(
        app,
        job_id,
        "finalizing",
        article_count,
        article_count,
        None,
        "Finalizing export".to_string(),
    )?;

    let _ = app.emit(
        EXPORT_EVENT,
        SavedArticlesExportEventCompleted {
            job_id: job_id.to_string(),
            status: "completed",
            message: format!("Export complete ({article_count})"),
            result: SavedArticlesExportCompletedPayload {
                output_path: output_path.to_string(),
                article_count,
                written_bytes,
                duration_ms: started_at.elapsed().as_millis() as u64,
            },
        },
    );

    Ok(())
}

fn emit_progress(
    app: &AppHandle,
    job_id: &str,
    phase: &'static str,
    article_count: i64,
    processed_articles: i64,
    written_bytes: Option<u64>,
    message: String,
) -> Result<(), String> {
    app.emit(
        EXPORT_EVENT,
        SavedArticlesExportEventProgress {
            job_id: job_id.to_string(),
            status: "progress",
            phase,
            article_count,
            processed_articles,
            written_bytes,
            message,
        },
    )
    .map_err(|error| format!("Failed to emit export progress event: {error}"))
}

fn count_saved_articles(connection: &Connection) -> Result<i64, String> {
    connection
        .query_row("SELECT COUNT(*) FROM saved_articles", [], |row| row.get(0))
        .map_err(|error| format!("Failed to count saved articles: {error}"))
}

fn estimate_saved_articles_export_bytes(connection: &Connection) -> Result<i64, String> {
    connection
        .query_row(
            r#"
            SELECT
              COALESCE(SUM(LENGTH(COALESCE(title, ''))), 0) +
              COALESCE(SUM(LENGTH(COALESCE(description, ''))), 0) +
              COALESCE(SUM(LENGTH(COALESCE(content, ''))), 0) +
              COALESCE(SUM(LENGTH(COALESCE(link, ''))), 0) +
              (COUNT(*) * 2048) + 256
            FROM saved_articles
            "#,
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Failed to estimate saved export size: {error}"))
}

fn feed_tags_for_article(connection: &Connection, feed_id: Option<&str>) -> Result<String, String> {
    let Some(feed_id) = feed_id else {
        return Ok(String::new());
    };

    let mut statement = connection
        .prepare("SELECT tag_name FROM feed_tags WHERE feed_id = ?1 ORDER BY tag_name COLLATE NOCASE")
        .map_err(|error| format!("Failed to prepare feed tag lookup: {error}"))?;
    let tags = statement
        .query_map([feed_id], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Failed to query feed tags: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read feed tag row: {error}"))?;

    Ok(tags.join("|"))
}

fn saved_article_time_added(row: &SavedArticleRecord) -> i64 {
    let source = row
        .saved_date
        .parse::<chrono::DateTime<chrono::Utc>>()
        .ok()
        .or_else(|| {
            row.published_date
                .as_ref()
                .and_then(|value| value.parse::<chrono::DateTime<chrono::Utc>>().ok())
        });

    source
        .map(|value| value.timestamp())
        .unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_secs() as i64)
                .unwrap_or(0)
        })
}

fn get_free_bytes_for_path(_output_path: &str) -> Option<u64> {
    None
}
