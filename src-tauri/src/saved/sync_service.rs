use std::{
    collections::{HashMap, HashSet},
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

struct IncrementalIndexState {
    initial_entries: Vec<SavedArticleIndexEntry>,
    entry_by_file_name: HashMap<String, SavedArticleIndexEntry>,
    updated_file_names: Vec<String>,
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

    let index_path = PathBuf::from(&folder_path).join(SAVED_ARTICLES_MARKDOWN_INDEX_FILE);
    let existing_index_entries = read_index_entries(&index_path)?;
    let mut known_file_names = index_file_names(&existing_index_entries);
    let mut used_names = used_names_from_file_names(known_file_names.iter());
    let mut new_index_entries = Vec::new();

    let connection = open_readonly_connection(db_path)?;
    let article_count = count_saved_articles(&connection)?;
    let mut offset = 0_i64;

    while offset < article_count {
        let rows = get_saved_articles_page(&connection, PAGE_SIZE, offset)?;
        for row in rows {
            let (normalized_title, file_name) =
                create_saved_article_markdown_file_name(row.title.as_deref(), &mut used_names);
            let markdown_path = articles_dir.join(&file_name);

            if known_file_names.contains(&file_name) || markdown_path.exists() {
                continue;
            }

            write_new_file(&markdown_path, &create_saved_article_markdown(&row))?;
            known_file_names.insert(file_name.clone());
            new_index_entries.push(SavedArticleIndexEntry {
                title: normalized_title,
                file_name,
            });
        }
        offset += PAGE_SIZE;
    }

    if !new_index_entries.is_empty() {
        let merged_entries =
            merge_index_entries(&existing_index_entries, &new_index_entries, &[]);
        write_if_changed(
            &index_path,
            &build_saved_articles_index_markdown(&merged_entries),
        )?;
    }

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
    let index_entries = read_index_entries(&index_path)?;
    let mut index_state = IncrementalIndexState {
        initial_entries: index_entries.clone(),
        entry_by_file_name: index_entries
            .into_iter()
            .map(|entry| (entry.file_name.clone(), entry))
            .collect(),
        updated_file_names: Vec::new(),
    };
    let mut used_names = used_names_from_file_names(index_state.entry_by_file_name.keys());

    let connection = open_readonly_connection(db_path)?;

    for event in events.values() {
        if event.event_type == "saved" {
            let row = get_saved_article_by_id(&connection, &event.saved_article_id)?;
            let Some(row) = row else {
                continue;
            };

            let (normalized_title, file_name) =
                create_saved_article_markdown_file_name(row.title.as_deref(), &mut used_names);
            let markdown_path = articles_dir.join(&file_name);

            if !markdown_path.exists() {
                write_new_file(&markdown_path, &create_saved_article_markdown(&row))?;
            }

            index_state.entry_by_file_name.insert(
                file_name.clone(),
                SavedArticleIndexEntry {
                    title: normalized_title,
                    file_name: file_name.clone(),
                },
            );
            track_updated_file_name(&mut index_state.updated_file_names, &file_name);
            continue;
        }

        let Some(title) = event.title.as_deref() else {
            continue;
        };
        let (_, file_name) =
            create_saved_article_markdown_file_name(Some(title), &mut HashMap::new());
        index_state.entry_by_file_name.remove(&file_name);
        remove_updated_file_name(&mut index_state.updated_file_names, &file_name);
        let _ = fs::remove_file(articles_dir.join(&file_name));
    }

    let merged_entries = build_incremental_index_entries(&index_state);
    write_if_changed(
        &index_path,
        &build_saved_articles_index_markdown(&merged_entries),
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
            file_name: decode_path_segment(link),
        });
    }

    Ok(entries)
}

fn index_file_names(entries: &[SavedArticleIndexEntry]) -> HashSet<String> {
    entries
        .iter()
        .map(|entry| entry.file_name.clone())
        .collect()
}

fn used_names_from_file_names<'a, I>(file_names: I) -> HashMap<String, u32>
where
    I: IntoIterator<Item = &'a String>,
{
    let mut used_names = HashMap::new();
    for file_name in file_names {
        register_existing_file_name(&mut used_names, file_name);
    }
    used_names
}

fn register_existing_file_name(used_names: &mut HashMap<String, u32>, file_name: &str) {
    let base = file_name.strip_suffix(".md").unwrap_or(file_name);
    if let Some(dash_index) = base.rfind('-') {
        let (base_name, suffix) = base.split_at(dash_index);
        let suffix = suffix.trim_start_matches('-');
        if !suffix.is_empty() && suffix.chars().all(|character| character.is_ascii_digit()) {
            if let Ok(number) = suffix.parse::<u32>() {
                let entry = used_names.entry(base_name.to_string()).or_insert(0);
                if number > *entry {
                    *entry = number;
                }
                return;
            }
        }
    }

    let entry = used_names.entry(base.to_string()).or_insert(0);
    if *entry < 1 {
        *entry = 1;
    }
}

fn merge_index_entries(
    existing_entries: &[SavedArticleIndexEntry],
    new_entries: &[SavedArticleIndexEntry],
    updated_newest_first: &[String],
) -> Vec<SavedArticleIndexEntry> {
    let mut seen = HashSet::new();
    let mut merged = Vec::new();

    for file_name in updated_newest_first.iter().rev() {
        if let Some(entry) = new_entries
            .iter()
            .chain(existing_entries.iter())
            .find(|entry| &entry.file_name == file_name)
        {
            if seen.insert(entry.file_name.clone()) {
                merged.push(entry.clone());
            }
        }
    }

    for entry in new_entries.iter().chain(existing_entries.iter()) {
        if seen.insert(entry.file_name.clone()) {
            merged.push(entry.clone());
        }
    }

    merged
}

fn build_incremental_index_entries(index_state: &IncrementalIndexState) -> Vec<SavedArticleIndexEntry> {
    let touched_file_names: HashSet<String> = index_state
        .updated_file_names
        .iter()
        .cloned()
        .collect();
    let mut merged = Vec::new();

    for file_name in index_state.updated_file_names.iter().rev() {
        if let Some(entry) = index_state.entry_by_file_name.get(file_name) {
            merged.push(entry.clone());
        }
    }

    for entry in &index_state.initial_entries {
        if index_state.entry_by_file_name.contains_key(&entry.file_name)
            && !touched_file_names.contains(&entry.file_name)
        {
            merged.push(entry.clone());
        }
    }

    merged
}

fn track_updated_file_name(updated_file_names: &mut Vec<String>, file_name: &str) {
    remove_updated_file_name(updated_file_names, file_name);
    updated_file_names.push(file_name.to_string());
}

fn remove_updated_file_name(updated_file_names: &mut Vec<String>, file_name: &str) {
    if let Some(index) = updated_file_names.iter().position(|value| value == file_name) {
        updated_file_names.remove(index);
    }
}

fn decode_path_segment(segment: &str) -> String {
    let bytes = segment.as_bytes();
    let mut decoded = String::with_capacity(segment.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(&segment[index + 1..index + 3], 16) {
                decoded.push(char::from(value));
                index += 3;
                continue;
            }
        }

        decoded.push(char::from(bytes[index]));
        index += 1;
    }

    decoded
}

fn write_new_file(path: &Path, content: &str) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create directory for sync file: {error}"))?;
    }

    fs::write(path, content).map_err(|error| format!("Failed to write sync file: {error}"))
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

fn count_saved_articles(connection: &Connection) -> Result<i64, String> {
    connection
        .query_row("SELECT COUNT(*) FROM saved_articles", [], |row| row.get(0))
        .map_err(|error| format!("Failed to count saved articles: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_index_entries_preserves_existing_and_prepends_new() {
        let existing = vec![SavedArticleIndexEntry {
            title: "Existing".to_string(),
            file_name: "Existing.md".to_string(),
        }];
        let new_entries = vec![SavedArticleIndexEntry {
            title: "Fresh".to_string(),
            file_name: "Fresh.md".to_string(),
        }];

        let merged = merge_index_entries(&existing, &new_entries, &[]);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].file_name, "Fresh.md");
        assert_eq!(merged[1].file_name, "Existing.md");
    }

    #[test]
    fn write_new_file_does_not_replace_existing_markdown() {
        let temp_dir = std::env::temp_dir().join(format!(
            "kiji-sync-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(&temp_dir).expect("create temp dir");
        let file_path = temp_dir.join("Existing.md");
        fs::write(&file_path, "manual content").expect("seed file");

        write_new_file(&file_path, "replacement").expect("write should noop");
        let contents = fs::read_to_string(&file_path).expect("read file");
        assert_eq!(contents, "manual content");

        let _ = fs::remove_dir_all(temp_dir);
    }
}
