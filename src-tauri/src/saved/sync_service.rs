use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use rusqlite::Connection;
use serde::Deserialize;
use tauri::State;

use crate::db::{get_saved_article_by_id, get_saved_articles_page};
use crate::settings::SettingsState;

use super::export_format::{
    build_saved_articles_index_markdown, create_saved_article_markdown,
    create_saved_article_markdown_file_name, SavedArticleIndexEntry,
    SAVED_ARTICLES_MARKDOWN_ARTICLES_DIR, SAVED_ARTICLES_MARKDOWN_INDEX_FILE,
};

const PAGE_SIZE: i64 = 50;
const SETTINGS_CHANGE_DELAY_MS: u64 = 5000;
const SAVED_ARTICLE_EVENT_DELAY_MS: u64 = 500;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedArticlesSyncEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub saved_article_id: String,
    pub title: Option<String>,
}

struct PendingSyncWork {
    requires_full_reconcile: bool,
    reason: Option<String>,
    mutation_events: HashMap<String, SavedArticlesSyncEvent>,
}

impl PendingSyncWork {
    fn new() -> Self {
        Self {
            requires_full_reconcile: false,
            reason: None,
            mutation_events: HashMap::new(),
        }
    }
}

pub struct SavedSyncState {
    db_path: PathBuf,
    settings_state: Arc<SettingsState>,
    pending: Arc<Mutex<PendingSyncWork>>,
    worker_scheduled: Arc<Mutex<bool>>,
    last_known_folder: Mutex<Option<String>>,
}

impl SavedSyncState {
    pub fn new(db_path: PathBuf, settings_state: Arc<SettingsState>) -> Self {
        Self {
            db_path,
            settings_state,
            pending: Arc::new(Mutex::new(PendingSyncWork::new())),
            worker_scheduled: Arc::new(Mutex::new(false)),
            last_known_folder: Mutex::new(None),
        }
    }

    pub fn schedule_startup_reconcile(&self) {
        if self.current_folder_path().is_none() {
            return;
        }

        self.schedule_work(SyncScheduleRequest {
            reason: "startup".to_string(),
            delay_ms: 0,
            requires_full_reconcile: true,
            mutation_event: None,
        });
    }

    pub fn handle_settings_changed(&self) {
        let previous = self
            .last_known_folder
            .lock()
            .ok()
            .and_then(|value| value.clone());
        let next = self.refresh_known_folder();

        if next.is_some() && next != previous {
            self.schedule_work(SyncScheduleRequest {
                reason: "settings-changed".to_string(),
                delay_ms: SETTINGS_CHANGE_DELAY_MS,
                requires_full_reconcile: true,
                mutation_event: None,
            });
        }
    }

    pub fn queue_mutation(&self, event: SavedArticlesSyncEvent) {
        if self.current_folder_path().is_none() {
            return;
        }

        self.schedule_work(SyncScheduleRequest {
            reason: format!("{}-article", event.event_type),
            delay_ms: SAVED_ARTICLE_EVENT_DELAY_MS,
            requires_full_reconcile: false,
            mutation_event: Some(event),
        });
    }

    fn refresh_known_folder(&self) -> Option<String> {
        let folder = self.current_folder_path();
        if let Ok(mut last_known) = self.last_known_folder.lock() {
            *last_known = folder.clone();
        }
        folder
    }

    fn current_folder_path(&self) -> Option<String> {
        self.settings_state
            .snapshot()
            .ok()?
            .saved_articles_sync_folder
            .filter(|value| !value.trim().is_empty())
    }

    fn schedule_work(&self, request: SyncScheduleRequest) {
        {
            let mut pending = match self.pending.lock() {
                Ok(value) => value,
                Err(_) => return,
            };

            if request.requires_full_reconcile {
                pending.requires_full_reconcile = true;
                pending.reason = Some(request.reason.clone());
            } else if pending.reason.is_none() {
                pending.reason = Some(request.reason.clone());
            }

            if let Some(event) = request.mutation_event {
                pending
                    .mutation_events
                    .insert(event.saved_article_id.clone(), event);
            }
        }

        let mut worker_scheduled = match self.worker_scheduled.lock() {
            Ok(value) => value,
            Err(_) => return,
        };

        if *worker_scheduled {
            return;
        }

        *worker_scheduled = true;
        let worker = SavedSyncWorker {
            db_path: self.db_path.clone(),
            settings_state: Arc::clone(&self.settings_state),
            pending: Arc::clone(&self.pending),
            worker_scheduled: Arc::clone(&self.worker_scheduled),
            delay_ms: request.delay_ms,
        };

        thread::spawn(move || worker.run());
    }
}

struct SyncScheduleRequest {
    reason: String,
    delay_ms: u64,
    requires_full_reconcile: bool,
    mutation_event: Option<SavedArticlesSyncEvent>,
}

struct SavedSyncWorker {
    db_path: PathBuf,
    settings_state: Arc<SettingsState>,
    pending: Arc<Mutex<PendingSyncWork>>,
    worker_scheduled: Arc<Mutex<bool>>,
    delay_ms: u64,
}

impl SavedSyncWorker {
    fn run(self) {
        thread::sleep(Duration::from_millis(self.delay_ms));

        loop {
            let next_action = {
                let mut pending = match self.pending.lock() {
                    Ok(value) => value,
                    Err(_) => break,
                };

                if pending.requires_full_reconcile {
                    pending.mutation_events.clear();
                    pending.requires_full_reconcile = false;
                    let reason = pending
                        .reason
                        .take()
                        .unwrap_or_else(|| "unknown".to_string());
                    SyncAction::Reconcile(reason)
                } else if !pending.mutation_events.is_empty() {
                    let events = std::mem::take(&mut pending.mutation_events);
                    pending.reason = None;
                    SyncAction::Mutations(events)
                } else {
                    break;
                }
            };

            match next_action {
                SyncAction::Reconcile(reason) => {
                    let _ = reconcile_folder(&self.db_path, &self.settings_state, &reason);
                }
                SyncAction::Mutations(events) => {
                    let _ = apply_mutations(&self.db_path, &self.settings_state, events);
                }
            }
        }

        if let Ok(mut worker_scheduled) = self.worker_scheduled.lock() {
            *worker_scheduled = false;
        }
    }
}

enum SyncAction {
    Reconcile(String),
    Mutations(HashMap<String, SavedArticlesSyncEvent>),
}

#[tauri::command(rename_all = "camelCase")]
pub fn saved_sync_queue(
    request: SavedArticlesSyncEvent,
    sync_state: State<'_, SavedSyncState>,
) -> Result<(), String> {
    sync_state.queue_mutation(request);
    Ok(())
}

fn open_readonly_connection(db_path: &Path) -> Result<Connection, String> {
    Connection::open(db_path)
        .map_err(|error| format!("Failed to open database for saved article sync: {error}"))
}

fn reconcile_folder(
    db_path: &Path,
    settings_state: &SettingsState,
    _reason: &str,
) -> Result<(), String> {
    let folder_path = settings_state
        .snapshot()?
        .saved_articles_sync_folder
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Saved articles sync folder is not configured.".to_string())?;

    let articles_dir = PathBuf::from(&folder_path).join(SAVED_ARTICLES_MARKDOWN_ARTICLES_DIR);
    fs::create_dir_all(&articles_dir)
        .map_err(|error| format!("Failed to create saved articles sync directory: {error}"))?;

    let connection = open_readonly_connection(db_path)?;
    let article_count = count_saved_articles(&connection)?;
    let mut used_names = HashMap::new();
    let mut entries = Vec::new();
    let mut expected_file_names = HashMap::new();
    let mut offset = 0_i64;

    while offset < article_count {
        let rows = get_saved_articles_page(&connection, PAGE_SIZE, offset)?;
        for row in rows {
            let (normalized_title, file_name) =
                create_saved_article_markdown_file_name(row.title.as_deref(), &mut used_names);
            let markdown = create_saved_article_markdown(&row);
            let markdown_path = articles_dir.join(&file_name);
            write_if_changed(&markdown_path, &markdown)?;
            entries.push(SavedArticleIndexEntry {
                title: normalized_title,
                file_name: file_name.clone(),
            });
            expected_file_names.insert(file_name, true);
        }
        offset += PAGE_SIZE;
    }

    remove_stale_markdown_files(&articles_dir, &expected_file_names)?;
    let index_path = PathBuf::from(&folder_path).join(SAVED_ARTICLES_MARKDOWN_INDEX_FILE);
    write_if_changed(&index_path, &build_saved_articles_index_markdown(&entries))?;
    Ok(())
}

fn apply_mutations(
    db_path: &Path,
    settings_state: &SettingsState,
    events: HashMap<String, SavedArticlesSyncEvent>,
) -> Result<(), String> {
    if events.is_empty() {
        return Ok(());
    }

    let folder_path = settings_state
        .snapshot()?
        .saved_articles_sync_folder
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Saved articles sync folder is not configured.".to_string())?;

    let articles_dir = PathBuf::from(&folder_path).join(SAVED_ARTICLES_MARKDOWN_ARTICLES_DIR);
    fs::create_dir_all(&articles_dir)
        .map_err(|error| format!("Failed to create saved articles sync directory: {error}"))?;

    let index_path = PathBuf::from(&folder_path).join(SAVED_ARTICLES_MARKDOWN_INDEX_FILE);
    let mut index_entries = read_index_entries(&index_path)?;
    let connection = open_readonly_connection(db_path)?;

    for event in events.values() {
        if event.event_type == "saved" {
            let row = get_saved_article_by_id(&connection, &event.saved_article_id)?;
            let Some(row) = row else {
                continue;
            };

            let (normalized_title, file_name) =
                create_saved_article_markdown_file_name(row.title.as_deref(), &mut HashMap::new());
            let markdown = create_saved_article_markdown(&row);
            write_if_changed(&articles_dir.join(&file_name), &markdown)?;
            index_entries.retain(|entry| entry.file_name != file_name);
            index_entries.insert(
                0,
                SavedArticleIndexEntry {
                    title: normalized_title,
                    file_name: file_name.clone(),
                },
            );
            continue;
        }

        let Some(title) = event.title.as_deref() else {
            continue;
        };
        let (_, file_name) =
            create_saved_article_markdown_file_name(Some(title), &mut HashMap::new());
        index_entries.retain(|entry| entry.file_name != file_name);
        let _ = fs::remove_file(articles_dir.join(&file_name));
    }

    write_if_changed(
        &index_path,
        &build_saved_articles_index_markdown(&index_entries),
    )?;
    Ok(())
}

fn read_index_entries(index_path: &Path) -> Result<Vec<SavedArticleIndexEntry>, String> {
    let raw = match fs::read_to_string(index_path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("Failed to read saved articles sync index: {error}")),
    };

    let mut entries = Vec::new();
    for line in raw.lines() {
        let Some(rest) = line.strip_prefix("- [") else {
            continue;
        };
        let Some((title, link)) = rest.split_once("](") else {
            continue;
        };
        let Some(link) = link
            .strip_prefix("./articles/")
            .and_then(|value| value.strip_suffix(')'))
        else {
            continue;
        };
        entries.push(SavedArticleIndexEntry {
            title: title.replace("\\[", "[").replace("\\]", "]"),
            file_name: link.to_string(),
        });
    }

    Ok(entries)
}

fn write_if_changed(path: &Path, content: &str) -> Result<(), String> {
    let current = fs::read_to_string(path).unwrap_or_default();
    if current == content {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create directory for sync file: {error}"))?;
    }

    fs::write(path, content).map_err(|error| format!("Failed to write sync file: {error}"))
}

fn remove_stale_markdown_files(
    articles_dir: &Path,
    expected_file_names: &HashMap<String, bool>,
) -> Result<(), String> {
    let entries = fs::read_dir(articles_dir)
        .map_err(|error| format!("Failed to read saved articles sync directory: {error}"))?;

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Failed to read sync directory entry: {error}"))?;
        if !entry
            .file_type()
            .map(|value| value.is_file())
            .unwrap_or(false)
        {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();
        if !expected_file_names.contains_key(&file_name) {
            fs::remove_file(entry.path())
                .map_err(|error| format!("Failed to remove stale sync file: {error}"))?;
        }
    }

    Ok(())
}

fn count_saved_articles(connection: &Connection) -> Result<i64, String> {
    connection
        .query_row("SELECT COUNT(*) FROM saved_articles", [], |row| row.get(0))
        .map_err(|error| format!("Failed to count saved articles: {error}"))
}
