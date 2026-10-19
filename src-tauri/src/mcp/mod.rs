//! Assistant access (MCP): lets AI clients read the user's library through
//! the Model Context Protocol. Off by default; read-only unless the separate
//! "Allow assistants to make changes" toggle is on (see `write`).
//!
//! - The server runs inside the app (never a second process opening
//!   `kiji.db`, which startup sidecar cleanup could corrupt).
//! - Clients connect through `kiji-app --mcp` (stdio bridge → local socket /
//!   named pipe) or, when enabled, a loopback HTTP endpoint with a bearer key.
//! - Every read runs on a dedicated read-only connection with a timeout;
//!   write tools run on the app's writer and notify windows to refresh.

pub mod bridge;
mod client_setup;
mod current;
mod endpoint;
mod extension;
mod format;
mod http;
mod protocol;
mod query;
mod settings;
mod time_range;
mod transport;
mod write;

use crate::db::DbState;
use chrono::{SecondsFormat, Utc};
use current::{CurrentArticle, CurrentArticleInput, CurrentArticleRegistry};
use protocol::{Session, CURRENT_ARTICLE_URI};
use serde::Serialize;
use serde_json::{json, Value};
use settings::{AssistantSettings, AssistantSettingsPatch, AssistantSettingsView};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Manager, State, Window};
use tokio::sync::{mpsc, watch, Notify};

/// Longest a single assistant query may run before it is interrupted.
const QUERY_TIMEOUT: Duration = Duration::from_secs(8);
const CURRENT_NOTIFY_DEBOUNCE: Duration = Duration::from_millis(500);
const LIBRARY_POLL_INTERVAL: Duration = Duration::from_secs(30);
/// Tells every window whether to publish its current article (payload: bool).
pub const CURRENT_ARTICLE_SHARING_EVENT: &str = "assistant-current-article-sharing";

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TransportKind {
    Local,
    Url,
}

struct SessionEntry {
    transport: TransportKind,
    session: Arc<Mutex<Session>>,
    /// Push channel for notifications (stream transports only).
    notifier: Option<mpsc::Sender<String>>,
    close: Arc<Notify>,
    connected_at: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "state", content = "message")]
pub enum ListenerState {
    Off,
    Starting,
    Ready,
    Error(String),
}

#[derive(Clone, Debug)]
struct ListenerStatus {
    local: ListenerState,
    http: ListenerState,
}

struct RunningServer {
    shutdown: watch::Sender<bool>,
    tasks: Vec<tauri::async_runtime::JoinHandle<()>>,
}

pub struct AssistantState {
    settings_path: PathBuf,
    settings: Mutex<AssistantSettings>,
    current: CurrentArticleRegistry,
    db: DbState,
    sessions: Mutex<BTreeMap<u64, SessionEntry>>,
    next_session_id: AtomicU64,
    server: Mutex<Option<RunningServer>>,
    /// Listener tasks told to stop but maybe not finished; the next start
    /// waits for them so an old socket/port never collides with a new one.
    retiring: Mutex<Vec<tauri::async_runtime::JoinHandle<()>>>,
    /// Bumped on every apply; stale listeners can't overwrite newer status.
    generation: AtomicU64,
    status: Mutex<ListenerStatus>,
    current_notify_pending: AtomicBool,
    app: Mutex<Option<AppHandle>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedClient {
    pub name: String,
    pub transport: TransportKind,
    pub connected_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_action: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantStatus {
    pub settings: AssistantSettingsView,
    pub local: ListenerState,
    pub http: ListenerState,
    pub clients: Vec<ConnectedClient>,
}

pub fn now_stamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

impl AssistantState {
    pub fn load(app: &AppHandle, db: DbState) -> Result<Arc<Self>, String> {
        let config_dir = app
            .path()
            .app_config_dir()
            .map_err(|error| format!("Failed to resolve the app config directory: {error}"))?;
        std::fs::create_dir_all(&config_dir)
            .map_err(|error| format!("Failed to create the app config directory: {error}"))?;
        let state = Self::load_from(settings::settings_path(&config_dir), db)?;
        if let Ok(mut handle) = state.app.lock() {
            *handle = Some(app.clone());
        }
        Ok(state)
    }

    fn load_from(settings_path: PathBuf, db: DbState) -> Result<Arc<Self>, String> {
        let mut loaded = settings::load_settings(&settings_path)?;
        if loaded.ensure_access_key() {
            settings::save_settings(&settings_path, &loaded)?;
        }
        Ok(Arc::new(Self {
            settings_path,
            settings: Mutex::new(loaded),
            current: CurrentArticleRegistry::default(),
            db,
            sessions: Mutex::new(BTreeMap::new()),
            next_session_id: AtomicU64::new(1),
            server: Mutex::new(None),
            retiring: Mutex::new(Vec::new()),
            generation: AtomicU64::new(0),
            status: Mutex::new(ListenerStatus { local: ListenerState::Off, http: ListenerState::Off }),
            current_notify_pending: AtomicBool::new(false),
            app: Mutex::new(None),
        }))
    }

    pub fn settings_snapshot(&self) -> AssistantSettings {
        self.settings.lock().map(|settings| settings.clone()).unwrap_or_default()
    }

    /// Windows publish their current article only while this is true, so
    /// article bodies don't cross IPC for users who never enabled access.
    pub fn current_article_sharing(&self) -> bool {
        self.settings
            .lock()
            .map(|settings| settings.enabled && settings.share_current_article)
            .unwrap_or(false)
    }

    fn emit_current_article_sharing(&self) {
        use tauri::Emitter;
        let sharing = self.current_article_sharing();
        if let Ok(handle) = self.app.lock() {
            if let Some(app) = handle.as_ref() {
                let _ = app.emit(CURRENT_ARTICLE_SHARING_EVENT, sharing);
            }
        }
    }

    fn emit_library_change(&self, change: &write::LibraryChange) {
        use tauri::Emitter;
        if let Ok(handle) = self.app.lock() {
            if let Some(app) = handle.as_ref() {
                if let Err(error) = app.emit(write::LIBRARY_CHANGED_EVENT, change) {
                    eprintln!("[KiJi] Assistant library change event failed: {error}");
                }
            }
        }
    }

    /// Saved-folder sync for a snapshot an assistant created (the renderer
    /// queues its own saves the same way through `saved_sync_queue`).
    fn queue_saved_folder_sync(&self, snapshot: &write::SavedSnapshot) {
        let Ok(handle) = self.app.lock() else { return };
        let Some(app) = handle.as_ref() else { return };
        if let Some(sync) = app.try_state::<crate::saved::SavedSyncState>() {
            sync.queue_mutation(crate::saved::SavedArticlesSyncEvent {
                event_type: "saved".to_string(),
                saved_article_id: snapshot.id.clone(),
                title: snapshot.title.clone(),
            });
        }
    }

    /// Tells connected clients to re-read `tools/list` (write tools appear
    /// or disappear with the "Allow changes" toggle).
    fn notify_tools_changed(&self) {
        let notification = json!({ "jsonrpc": "2.0", "method": "notifications/tools/list_changed" }).to_string();
        let Ok(sessions) = self.sessions.lock() else { return };
        for entry in sessions.values() {
            if let Some(notifier) = &entry.notifier {
                let _ = notifier.try_send(notification.clone());
            }
        }
    }

    fn is_enabled(&self) -> bool {
        self.settings.lock().map(|settings| settings.enabled).unwrap_or(false)
    }

    /// Starts or stops listeners to match the saved settings. Old listeners
    /// are told to stop and fully finish before new ones bind.
    pub fn apply(self: &Arc<Self>) {
        let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        let mut waits = self.retiring.lock().map(|mut list| std::mem::take(&mut *list)).unwrap_or_default();
        if let Some(previous) = self.server.lock().ok().and_then(|mut server| server.take()) {
            let _ = previous.shutdown.send(true);
            waits.extend(previous.tasks);
        }
        self.close_all_sessions();
        let settings = self.settings_snapshot();
        if !settings.enabled {
            self.current.clear_all();
            self.set_local_status(generation, ListenerState::Off);
            self.set_http_status(generation, ListenerState::Off);
            if let Ok(mut list) = self.retiring.lock() {
                list.extend(waits);
            }
            return;
        }
        self.set_local_status(generation, ListenerState::Starting);
        self.set_http_status(
            generation,
            if settings.http_enabled { ListenerState::Starting } else { ListenerState::Off },
        );

        let state = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            for task in waits {
                let _ = task.await;
            }
            if state.generation.load(Ordering::Acquire) != generation {
                return;
            }
            let (shutdown, shutdown_rx) = watch::channel(false);
            let mut tasks = vec![transport::spawn_local_listener(
                Arc::clone(&state),
                shutdown_rx.clone(),
                generation,
            )];
            if settings.http_enabled {
                tasks.push(http::spawn_http_listener(
                    Arc::clone(&state),
                    settings.http_port,
                    shutdown_rx.clone(),
                    generation,
                ));
            }
            tasks.push(spawn_library_watch(Arc::clone(&state), shutdown_rx));
            let Ok(mut server) = state.server.lock() else { return };
            if state.generation.load(Ordering::Acquire) != generation {
                // A newer apply ran meanwhile: retire these right away.
                let _ = shutdown.send(true);
                drop(server);
                if let Ok(mut list) = state.retiring.lock() {
                    list.extend(tasks);
                }
                return;
            }
            *server = Some(RunningServer { shutdown, tasks });
        });
    }

    /// App exit: stop listeners without waiting (a stale socket is cleaned
    /// up on the next launch).
    pub fn shutdown(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
        if let Some(running) = self.server.lock().ok().and_then(|mut server| server.take()) {
            let _ = running.shutdown.send(true);
        }
        self.close_all_sessions();
        self.current.clear_all();
    }

    fn is_current_generation(&self, generation: u64) -> bool {
        self.generation.load(Ordering::Acquire) == generation
    }

    fn set_local_status(&self, generation: u64, state: ListenerState) {
        if !self.is_current_generation(generation) {
            return;
        }
        if let Ok(mut status) = self.status.lock() {
            status.local = state;
        }
    }

    fn set_http_status(&self, generation: u64, state: ListenerState) {
        if !self.is_current_generation(generation) {
            return;
        }
        if let Ok(mut status) = self.status.lock() {
            status.http = state;
        }
    }

    fn update_settings(self: &Arc<Self>, patch: AssistantSettingsPatch) -> Result<(), String> {
        let (before, after) = {
            let mut guard = self
                .settings
                .lock()
                .map_err(|_| "Failed to lock the assistant settings.".to_string())?;
            let before = guard.clone();
            let mut next = guard.clone();
            next.apply_patch(patch)?;
            settings::save_settings(&self.settings_path, &next)?;
            *guard = next.clone();
            (before, next)
        };
        let listeners_changed = before.enabled != after.enabled
            || before.http_enabled != after.http_enabled
            || before.http_port != after.http_port;
        if listeners_changed {
            self.apply();
        }
        let sharing_before = before.enabled && before.share_current_article;
        let sharing_after = after.enabled && after.share_current_article;
        if !sharing_after {
            self.current.clear_all();
        }
        if sharing_before != sharing_after {
            // Windows re-send what they show when sharing turns on.
            self.emit_current_article_sharing();
        }
        if before.allow_changes != after.allow_changes && !listeners_changed {
            self.notify_tools_changed();
        }
        Ok(())
    }

    fn reset_access(self: &Arc<Self>) -> Result<(), String> {
        {
            let mut guard = self
                .settings
                .lock()
                .map_err(|_| "Failed to lock the assistant settings.".to_string())?;
            let mut next = guard.clone();
            next.reset_access_key();
            settings::save_settings(&self.settings_path, &next)?;
            *guard = next;
        }
        self.close_all_sessions();
        Ok(())
    }

    pub fn status(&self) -> AssistantStatus {
        let settings = self.settings_snapshot();
        let status = self
            .status
            .lock()
            .map(|status| status.clone())
            .unwrap_or(ListenerStatus { local: ListenerState::Off, http: ListenerState::Off });
        // Copy handles out first: never hold the map lock while locking a
        // session (sessions are only locked briefly, never across queries).
        let entries: Vec<(TransportKind, String, Arc<Mutex<Session>>)> = self
            .sessions
            .lock()
            .map(|sessions| {
                sessions
                    .values()
                    .map(|entry| (entry.transport, entry.connected_at.clone(), Arc::clone(&entry.session)))
                    .collect()
            })
            .unwrap_or_default();
        let clients = entries
            .into_iter()
            .filter_map(|(transport, connected_at, session)| {
                let session = session.lock().ok()?;
                // Hide raw connections that never introduced themselves.
                session.protocol_version.as_ref()?;
                Some(ConnectedClient {
                    name: session.client_name.clone().unwrap_or_else(|| "Assistant".to_string()),
                    transport,
                    connected_at,
                    last_used_at: session.last_used_at.clone(),
                    last_action: session.last_action.clone(),
                })
            })
            .collect();
        AssistantStatus {
            settings: AssistantSettingsView::from(&settings),
            local: status.local,
            http: status.http,
            clients,
        }
    }

    pub(crate) fn register_session(
        &self,
        transport: TransportKind,
        notifier: Option<mpsc::Sender<String>>,
    ) -> (u64, Arc<Mutex<Session>>, Arc<Notify>) {
        let id = self.next_session_id.fetch_add(1, Ordering::Relaxed);
        let session = Arc::new(Mutex::new(Session { can_push: notifier.is_some(), ..Default::default() }));
        let close = Arc::new(Notify::new());
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.insert(
                id,
                SessionEntry {
                    transport,
                    session: Arc::clone(&session),
                    notifier,
                    close: Arc::clone(&close),
                    connected_at: now_stamp(),
                },
            );
        }
        (id, session, close)
    }

    pub(crate) fn unregister_session(&self, id: u64) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(&id);
        }
    }

    pub(crate) fn session_by_id(&self, id: u64) -> Option<Arc<Mutex<Session>>> {
        self.sessions
            .lock()
            .ok()
            .and_then(|sessions| sessions.get(&id).map(|entry| Arc::clone(&entry.session)))
    }

    fn close_all_sessions(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for entry in sessions.values() {
                entry.close.notify_one();
            }
            sessions.clear();
        }
    }

    pub(crate) fn access_key_matches(&self, candidate: &str) -> bool {
        let Ok(settings) = self.settings.lock() else { return false };
        constant_time_eq(settings.access_key.as_bytes(), candidate.as_bytes())
    }

    /// Runs one JSON-RPC message for a session on the assistant reader.
    pub(crate) async fn handle(self: &Arc<Self>, session: &Arc<Mutex<Session>>, message: Value) -> Option<Value> {
        let id = message.as_object().and_then(|object| object.get("id")).cloned();
        if !self.is_enabled() {
            return id.map(|id| rpc_error(id, -32000, "Assistant access is turned off in KiJi."));
        }
        let settings = self.settings_snapshot();
        let current = if settings.share_current_article { self.current.current() } else { None };
        if let Some((id, name, args)) = write_call(&message) {
            if settings.allow_changes {
                return Some(self.handle_write(session, id, name, args, settings, current).await);
            }
            // Off: the read-only path answers with a plain "turned off" error.
        }
        // Work on a copy so the session lock is never held during a query
        // (the Settings status call reads sessions on the main thread).
        let Some(snapshot) = session.lock().ok().map(|guard| guard.clone()) else {
            return id.map(|id| rpc_error(id, -32603, "Assistant session is unavailable."));
        };
        let result = self
            .db
            .assistant_read(QUERY_TIMEOUT, move |conn| {
                let mut working = snapshot;
                working.last_used_at = Some(now_stamp());
                let ctx = protocol::RequestContext { conn, settings: &settings, current };
                let response = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    protocol::handle_message(&mut working, &ctx, &message)
                }))
                .map_err(|_| "KiJi hit an unexpected problem answering that request.".to_string())?;
                Ok((response, working))
            })
            .await;
        match result {
            Ok((response, updated)) => {
                if let Ok(mut guard) = session.lock() {
                    *guard = updated;
                }
                response
            }
            Err(message) => id.map(|id| rpc_error(id, -32603, &message)),
        }
    }

    /// Runs a write tool on the writer connection, then tells every window
    /// what changed. Never holds the session lock across the write.
    async fn handle_write(
        self: &Arc<Self>,
        session: &Arc<Mutex<Session>>,
        id: Value,
        name: String,
        args: Value,
        settings: AssistantSettings,
        current: Option<CurrentArticle>,
    ) -> Value {
        if let Ok(mut guard) = session.lock() {
            guard.last_used_at = Some(now_stamp());
            guard.last_action = Some(name.clone());
        }
        let result = self
            .db
            .write(move |conn| {
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    write::run(conn, &settings, current.as_ref(), &name, &args)
                }))
                .map_err(|_| "KiJi hit an unexpected problem making that change.".to_string())
            })
            .await;
        let outcome = match result {
            Ok(outcome) => outcome,
            Err(message) => return rpc_error(id, -32603, &message),
        };
        if let Ok(done) = &outcome {
            if !done.change.is_empty() {
                self.emit_library_change(&done.change);
                self.send_resource_updates(|uri| uri != CURRENT_ARTICLE_URI);
            }
            if let Some(snapshot) = &done.created_saved {
                self.queue_saved_folder_sync(snapshot);
            }
        }
        json!({ "jsonrpc": "2.0", "id": id, "result": write::tool_result(&outcome) })
    }

    fn set_current_article(self: &Arc<Self>, window_label: &str, input: CurrentArticleInput) -> Result<(), String> {
        let settings = self.settings_snapshot();
        if !settings.enabled || !settings.share_current_article {
            // Nothing is kept while sharing is off.
            return Ok(());
        }
        let article = CurrentArticle::from_input(window_label, input, now_stamp())?;
        if self.current.set(article) {
            self.notify_current_changed();
        }
        Ok(())
    }

    fn clear_current_article(self: &Arc<Self>, window_label: &str) {
        if self.current.clear(window_label) {
            self.notify_current_changed();
        }
    }

    pub fn window_focused(self: &Arc<Self>, window_label: &str) {
        if self.current.window_focused(window_label) {
            self.notify_current_changed();
        }
    }

    pub fn window_hidden(self: &Arc<Self>, window_label: &str) {
        if self.current.window_hidden(window_label) {
            self.notify_current_changed();
        }
    }

    pub fn window_shown(self: &Arc<Self>, window_label: &str) {
        if self.current.window_shown(window_label) {
            self.notify_current_changed();
        }
    }

    pub fn window_destroyed(self: &Arc<Self>, window_label: &str) {
        if self.current.window_destroyed(window_label) {
            self.notify_current_changed();
        }
    }

    fn notify_current_changed(self: &Arc<Self>) {
        if self.current_notify_pending.swap(true, Ordering::AcqRel) {
            return;
        }
        let state = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(CURRENT_NOTIFY_DEBOUNCE).await;
            state.current_notify_pending.store(false, Ordering::Release);
            state.send_resource_updates(|uri| uri == CURRENT_ARTICLE_URI);
        });
    }

    fn has_library_subscriptions(&self) -> bool {
        self.sessions
            .lock()
            .map(|sessions| {
                sessions.values().any(|entry| {
                    entry.notifier.is_some()
                        && entry
                            .session
                            .lock()
                            .map(|session| session.subscriptions.iter().any(|uri| uri != CURRENT_ARTICLE_URI))
                            .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    }

    fn send_resource_updates(&self, matches: impl Fn(&str) -> bool) {
        let Ok(sessions) = self.sessions.lock() else { return };
        for entry in sessions.values() {
            let Some(notifier) = &entry.notifier else { continue };
            let uris: Vec<String> = entry
                .session
                .lock()
                .map(|session| session.subscriptions.iter().filter(|uri| matches(uri)).cloned().collect())
                .unwrap_or_default();
            for uri in uris {
                let notification = json!({
                    "jsonrpc": "2.0",
                    "method": "notifications/resources/updated",
                    "params": { "uri": uri }
                });
                // Drop rather than block when a client stops reading.
                let _ = notifier.try_send(notification.to_string());
            }
        }
    }
}

/// Polls for new articles / saved items while someone subscribes to library
/// resources, so refresh code paths stay untouched.
fn spawn_library_watch(
    state: Arc<AssistantState>,
    mut shutdown: watch::Receiver<bool>,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let mut last: Option<(i64, i64)> = None;
        loop {
            tokio::select! {
                _ = shutdown.changed() => break,
                _ = tokio::time::sleep(LIBRARY_POLL_INTERVAL) => {}
            }
            if !state.has_library_subscriptions() {
                last = None;
                continue;
            }
            let marker = state
                .db
                .assistant_read(QUERY_TIMEOUT, |conn| {
                    conn.query_row(
                        "SELECT COALESCE((SELECT MAX(rowid) FROM articles), 0),
                                COALESCE((SELECT MAX(rowid) FROM saved_articles), 0)",
                        [],
                        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                    )
                    .map_err(|error| error.to_string())
                })
                .await;
            let Ok(marker) = marker else { continue };
            if last.is_some() && last != Some(marker) {
                state.send_resource_updates(|uri| uri != CURRENT_ARTICLE_URI);
            }
            last = Some(marker);
        }
    })
}

/// `(id, tool name, arguments)` when `message` is a `tools/call` request for
/// a write tool.
fn write_call(message: &Value) -> Option<(Value, String, Value)> {
    let object = message.as_object()?;
    if object.get("method").and_then(Value::as_str) != Some("tools/call") {
        return None;
    }
    let id = object.get("id")?.clone();
    let params = object.get("params")?;
    let name = params.get("name").and_then(Value::as_str)?;
    if !write::is_write_tool(name) {
        return None;
    }
    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    Some((id, name.to_string(), args))
}

pub(crate) fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn constant_time_eq(expected: &[u8], candidate: &[u8]) -> bool {
    if expected.is_empty() || expected.len() != candidate.len() {
        return false;
    }
    expected
        .iter()
        .zip(candidate)
        .fold(0u8, |diff, (left, right)| diff | (left ^ right))
        == 0
}

// ---------------------------------------------------------------------------
// Tauri commands

#[tauri::command]
pub fn assistant_get_status(state: State<'_, Arc<AssistantState>>) -> AssistantStatus {
    state.status()
}

#[tauri::command]
pub fn assistant_current_article_sharing(state: State<'_, Arc<AssistantState>>) -> bool {
    state.current_article_sharing()
}

#[tauri::command]
pub fn assistant_update_settings(
    patch: AssistantSettingsPatch,
    state: State<'_, Arc<AssistantState>>,
) -> Result<AssistantStatus, String> {
    state.update_settings(patch)?;
    Ok(state.status())
}

#[tauri::command]
pub fn assistant_reset_access(state: State<'_, Arc<AssistantState>>) -> Result<AssistantStatus, String> {
    state.reset_access()?;
    Ok(state.status())
}

#[tauri::command]
pub fn assistant_get_client_setup(
    client: String,
    state: State<'_, Arc<AssistantState>>,
) -> Result<client_setup::ClientSetup, String> {
    client_setup::build(&client, &state.settings_snapshot())
}

#[tauri::command]
pub fn assistant_open_client_link(client: String, app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let link = client_setup::install_link(&client)?;
    app.opener()
        .open_url(link, None::<&str>)
        .map_err(|error| format!("Failed to open the install link: {error}"))
}

#[tauri::command]
pub fn assistant_write_extension(path: String) -> Result<(), String> {
    extension::write_extension(std::path::Path::new(&path))
}

#[tauri::command]
pub fn assistant_set_current_article(
    article: CurrentArticleInput,
    window: Window,
    state: State<'_, Arc<AssistantState>>,
) -> Result<(), String> {
    state.set_current_article(window.label(), article)
}

#[tauri::command]
pub fn assistant_clear_current_article(window: Window, state: State<'_, Arc<AssistantState>>) {
    state.clear_current_article(window.label());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DbState;
    use rusqlite::Connection;

    fn state() -> Arc<AssistantState> {
        let dir = std::env::temp_dir().join(format!("kiji-assistant-state-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        AssistantState::load_from(settings::settings_path(&dir), DbState::for_tests(Connection::open_in_memory().unwrap()))
            .unwrap()
    }

    #[test]
    fn loading_creates_an_access_key_and_keeps_access_off() {
        let state = state();
        let settings = state.settings_snapshot();
        assert!(!settings.enabled);
        assert!(settings.access_key.len() >= 64);
        assert!(state.access_key_matches(&settings.access_key));
        assert!(!state.access_key_matches("wrong"));
        assert!(!state.access_key_matches(""));
    }

    #[test]
    fn current_article_is_not_kept_while_sharing_is_off() {
        let state = state();
        let input = CurrentArticleInput {
            kind: current::CurrentArticleKind::Feed,
            hash: Some("t1".into()),
            saved_id: None,
            title: None,
            link: None,
            feed_title: None,
            author: None,
            published_date: None,
            body_html: None,
            reader_mode: None,
        };
        state.set_current_article("main", input.clone()).unwrap();
        assert!(state.current.current().is_none(), "access is off by default");

        state.settings.lock().unwrap().enabled = true;
        state.set_current_article("main", input).unwrap();
        assert!(state.current.current().is_some());
    }

    #[tokio::test]
    async fn disabled_access_answers_requests_with_an_error() {
        let state = state();
        let (_, session, _) = state.register_session(TransportKind::Local, None);
        let response = state
            .handle(&session, json!({ "jsonrpc": "2.0", "id": 7, "method": "ping" }))
            .await
            .unwrap();
        assert_eq!(response["error"]["code"], -32000);
        assert!(state
            .handle(&session, json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
            .await
            .is_none());
    }

    #[tokio::test]
    async fn keyed_loopback_transport_serves_sessions_and_rejects_strangers() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        let state = state();
        state.settings.lock().unwrap().enabled = true;
        let dir = std::env::temp_dir().join(format!("kiji-tcp-{}", uuid::Uuid::new_v4()));
        let file = dir.join("mcp-endpoint.json");
        let (shutdown, shutdown_rx) = watch::channel(false);
        let generation = state.generation.load(Ordering::Acquire);
        let listener = tokio::spawn(transport::run_tcp_listener(Arc::clone(&state), shutdown_rx, generation, file.clone()));
        for _ in 0..100 {
            if file.exists() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        // Right key (via the bridge's connector): a working MCP session.
        let (reader, mut writer) = bridge::connect_tcp(&file).await.expect("connect");
        writer
            .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n")
            .await
            .unwrap();
        let mut lines = BufReader::new(reader);
        let mut line = String::new();
        lines.read_line(&mut line).await.unwrap();
        let reply: Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(reply["id"], 1);
        assert!(reply.get("result").is_some(), "{reply}");

        // Wrong key: the connection is closed without an answer.
        let endpoint = transport::read_endpoint_file(&file).unwrap();
        let mut stranger = tokio::net::TcpStream::connect(("127.0.0.1", endpoint.port)).await.unwrap();
        stranger
            .write_all(b"{\"kijiBridgeKey\":\"nope\"}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"ping\"}\n")
            .await
            .unwrap();
        let mut answer = String::new();
        let read = tokio::time::timeout(Duration::from_secs(2), BufReader::new(stranger).read_line(&mut answer)).await;
        assert!(matches!(read, Ok(Ok(0))), "stranger got: {answer}");

        let _ = shutdown.send(true);
        listener.await.unwrap().unwrap();
        assert!(!file.exists(), "endpoint file removed on shutdown");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn write_tools_run_on_the_writer_only_when_changes_are_allowed() {
        let dir = std::env::temp_dir().join(format!("kiji-assistant-write-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        // The writer holds the library; the assistant reader is an empty
        // database, so a write that ran on the reader would fail.
        let db = DbState::for_tests(query::tests::fixture());
        let state = AssistantState::load_from(settings::settings_path(&dir), db.clone()).unwrap();
        state.settings.lock().unwrap().enabled = true;
        let (_, session, _) = state.register_session(TransportKind::Local, None);
        let call = json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "mark_read", "arguments": { "hash": "t1" } } });
        let read_flag = || {
            let db = db.clone();
            async move {
                db.write(|conn| conn.query_row("SELECT read FROM articles WHERE hash = 't1'", [], |row| row.get::<_, i64>(0)).map_err(|e| e.to_string()))
                    .await
                    .unwrap()
            }
        };

        let off = state.handle(&session, call.clone()).await.unwrap();
        assert_eq!(off["result"]["isError"], true, "{off}");
        assert_eq!(read_flag().await, 0);

        state.settings.lock().unwrap().allow_changes = true;
        let on = state.handle(&session, call).await.unwrap();
        assert_eq!(on["result"]["isError"], false, "{on}");
        assert_eq!(on["result"]["structuredContent"]["changed"], json!(["t1"]));
        assert_eq!(read_flag().await, 1);
        assert_eq!(session.lock().unwrap().last_action.as_deref(), Some("mark_read"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reset_access_rotates_the_key_and_drops_sessions() {
        let state = state();
        let before = state.settings_snapshot().access_key;
        state.register_session(TransportKind::Url, None);
        state.reset_access().unwrap();
        assert_ne!(state.settings_snapshot().access_key, before);
        assert!(state.sessions.lock().unwrap().is_empty());
    }
}
