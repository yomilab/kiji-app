//! Unread count on the app icon and the opt-in "new articles" notification.
//!
//! - Badge: every committed database write wakes one long-lived task. It
//!   waits `BADGE_COALESCE` so a burst (a refresh cycle, Mark All as Read)
//!   settles, counts unread articles once and touches the icon only when the
//!   number changed. Runs natively, so it keeps working while the window is
//!   hidden. macOS (Dock) and Linux (Unity launcher count) only; Windows
//!   has no badge count, only a taskbar overlay image.
//! - Notification: after a background refresh cycle, at most one summary
//!   for the articles it added. Feeds fetched for the first time (new feed,
//!   OPML import), boosted after an import or refreshed by hand don't count,
//!   and nothing is posted while a KiJi window is focused. macOS: clicking it
//!   activates KiJi, which shows the main window.

use crate::db::DbState;
use crate::settings::{AppSettings, SettingsState};
use rusqlite::Connection;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Notify;

const BADGE_COALESCE: Duration = Duration::from_millis(1500);
/// Feeds named in the summary before "and N more".
const SUMMARY_NAMED_FEEDS: usize = 2;
const NOTIFICATION_TITLE: &str = "KiJi";

#[derive(Default)]
pub struct AttentionState {
    wake: Notify,
    /// What the icon shows now (`None` = no badge); skips redundant updates.
    shown_badge: Mutex<Option<i64>>,
    /// A summary was posted and KiJi hasn't been activated since.
    notification_pending: AtomicBool,
}

impl AttentionState {
    fn request_refresh(&self) {
        // One stored permit: any number of wakes during a pass collapse into
        // one more pass.
        self.wake.notify_one();
    }
}

/// Wires the badge to database commits and starts its coalescing task.
pub fn start(app: &AppHandle, db: &DbState) {
    let state = Arc::new(AttentionState::default());
    app.manage(Arc::clone(&state));
    // Off the setup thread: a startup data repair may hold the writer.
    let listener_state = Arc::clone(&state);
    let db = db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let wake_state = Arc::clone(&listener_state);
        if let Err(error) = db.set_commit_listener(move || wake_state.request_refresh()) {
            eprintln!("[KiJi] {error}");
        }
        // Launch: show the stored count without waiting for a write.
        listener_state.request_refresh();
    });

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            state.wake.notified().await;
            tokio::time::sleep(BADGE_COALESCE).await;
            refresh_badge(&app_handle, &state).await;
        }
    });

    #[cfg(target_os = "macos")]
    watch_app_activation(app);
}

/// Recount soon (coalesced). Safe to call from anywhere.
pub fn request_badge_refresh(app: &AppHandle) {
    if let Some(state) = app.try_state::<Arc<AttentionState>>() {
        state.request_refresh();
    }
}

fn settings_snapshot(app: &AppHandle) -> Option<AppSettings> {
    app.try_state::<Arc<SettingsState>>()
        .and_then(|settings| settings.snapshot().ok())
}

/// Unread stories (each story once, even when two subscriptions share it).
/// Counts entries of `idx_articles_read`; never reads article rows.
pub(crate) fn count_unread_articles(connection: &Connection) -> Result<i64, String> {
    connection
        .query_row("SELECT COUNT(*) FROM articles WHERE read = 0", [], |row| row.get(0))
        .map_err(|error| format!("Failed to count unread articles: {error}"))
}

/// What the icon should show: nothing when off or when everything is read.
pub fn badge_value(enabled: bool, unread: i64) -> Option<i64> {
    (enabled && unread > 0).then_some(unread)
}

async fn refresh_badge(app: &AppHandle, state: &AttentionState) {
    let enabled = settings_snapshot(app).map(|settings| settings.show_unread_badge).unwrap_or(true);
    let unread = if enabled {
        let Some(db) = app.try_state::<DbState>() else { return };
        let db = db.inner().clone();
        match db.read(count_unread_articles).await {
            Ok(count) => count,
            Err(error) => {
                eprintln!("[KiJi] {error}");
                return;
            }
        }
    } else {
        0
    };
    apply_badge(app, state, badge_value(enabled, unread));
}

fn apply_badge(app: &AppHandle, state: &AttentionState, target: Option<i64>) {
    let Ok(mut shown) = state.shown_badge.lock() else { return };
    if *shown == target {
        return;
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let Some(window) = app.get_webview_window(super::background::MAIN_WINDOW_LABEL) else { return };
        if let Err(error) = window.set_badge_count(target) {
            eprintln!("[KiJi] Couldn't update the app icon badge: {error}");
            return;
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let _ = app;
    *shown = target;
}

/// One feed's result in a refresh cycle (only feeds that added articles).
#[derive(Debug, Clone, PartialEq)]
pub struct CycleFeedNews {
    pub title: String,
    pub inserted: i64,
    /// The feed had never been fetched (just added or imported).
    pub first_fetch: bool,
    /// Boosted after an import or station switch.
    pub boosted: bool,
    /// Refreshed by hand.
    pub forced: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NewArticlesSummary {
    pub total: i64,
    /// Feed titles, most new articles first.
    pub feed_titles: Vec<String>,
}

/// Totals the articles worth announcing, or `None` when there are none.
pub fn summarize_cycle(feeds: &[CycleFeedNews]) -> Option<NewArticlesSummary> {
    let mut counted: Vec<&CycleFeedNews> = feeds
        .iter()
        .filter(|feed| feed.inserted > 0 && !feed.first_fetch && !feed.boosted && !feed.forced)
        .collect();
    if counted.is_empty() {
        return None;
    }
    counted.sort_by(|a, b| b.inserted.cmp(&a.inserted).then_with(|| a.title.cmp(&b.title)));
    Some(NewArticlesSummary {
        total: counted.iter().map(|feed| feed.inserted).sum(),
        feed_titles: counted.iter().map(|feed| display_title(&feed.title)).collect(),
    })
}

fn display_title(title: &str) -> String {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        "an untitled feed".to_string()
    } else {
        trimmed.to_string()
    }
}

/// "12 new articles from The Verge, Daring Fireball and 3 more".
pub fn summary_text(summary: &NewArticlesSummary) -> String {
    let noun = if summary.total == 1 { "article" } else { "articles" };
    let titles = &summary.feed_titles;
    let sources = match titles.len() {
        0 => return format!("{} new {noun}", summary.total),
        1 => titles[0].clone(),
        n if n <= SUMMARY_NAMED_FEEDS + 1 => {
            format!("{} and {}", titles[..n - 1].join(", "), titles[n - 1])
        }
        n => format!(
            "{} and {} more",
            titles[..SUMMARY_NAMED_FEEDS].join(", "),
            n - SUMMARY_NAMED_FEEDS
        ),
    };
    format!("{} new {noun} from {sources}", summary.total)
}

/// Gate before anything is counted: the user opted in, the cycle was a
/// scheduled background pass, and they aren't looking at KiJi.
pub fn should_notify(enabled: bool, background_cycle: bool, any_window_focused: bool) -> bool {
    enabled && background_cycle && !any_window_focused
}

fn any_window_focused(app: &AppHandle) -> bool {
    app.webview_windows()
        .values()
        .any(|window| window.is_focused().unwrap_or(false))
}

/// Called once at the end of every native refresh cycle.
pub fn after_refresh_cycle(app: &AppHandle, background_cycle: bool, feeds: &[CycleFeedNews]) {
    let enabled = settings_snapshot(app).map(|settings| settings.notify_new_articles).unwrap_or(false);
    if !should_notify(enabled, background_cycle, any_window_focused(app)) {
        return;
    }
    let Some(summary) = summarize_cycle(feeds) else { return };
    post_notification(app, &summary_text(&summary));
}

fn post_notification(app: &AppHandle, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    match app.notification().builder().title(NOTIFICATION_TITLE).body(body).show() {
        Ok(()) => {
            if let Some(state) = app.try_state::<Arc<AttentionState>>() {
                state.notification_pending.store(true, Ordering::Release);
            }
        }
        Err(error) => eprintln!("[KiJi] Couldn't post the new articles notification: {error}"),
    }
}

/// Clicking a notification activates KiJi; bring the main window back if
/// it is hidden or minimized. Other activations only clear the flag.
pub fn should_show_main_on_activate(pending: bool, main_visible: bool, main_minimized: bool) -> bool {
    pending && (!main_visible || main_minimized)
}

#[cfg(target_os = "macos")]
fn watch_app_activation(app: &AppHandle) {
    use block2::RcBlock;
    use objc2_app_kit::NSApplicationDidBecomeActiveNotification;
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSOperationQueue};
    use std::ptr::NonNull;

    let app = app.clone();
    let block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        let Some(state) = app.try_state::<Arc<AttentionState>>() else { return };
        let pending = state.notification_pending.swap(false, Ordering::AcqRel);
        let window = app.get_webview_window(super::background::MAIN_WINDOW_LABEL);
        let visible = window.as_ref().and_then(|w| w.is_visible().ok()).unwrap_or(false);
        let minimized = window.as_ref().and_then(|w| w.is_minimized().ok()).unwrap_or(false);
        if should_show_main_on_activate(pending, visible, minimized) {
            super::background::show_main_window(&app);
        }
    });
    unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(NSApplicationDidBecomeActiveNotification),
            None,
            Some(&NSOperationQueue::mainQueue()),
            &block,
        );
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttentionStatus {
    pub show_unread_badge: bool,
    pub notify_new_articles: bool,
    /// The app icon can show a count on this system (not Windows).
    pub badge_supported: bool,
    /// Turning notifications on was refused by the system.
    pub notifications_blocked: bool,
}

fn status(settings: &AppSettings, notifications_blocked: bool) -> AttentionStatus {
    AttentionStatus {
        show_unread_badge: settings.show_unread_badge,
        notify_new_articles: settings.notify_new_articles,
        badge_supported: cfg!(any(target_os = "macos", target_os = "linux")),
        notifications_blocked,
    }
}

#[tauri::command]
pub fn shell_attention_get(settings: State<'_, Arc<SettingsState>>) -> Result<AttentionStatus, String> {
    Ok(status(&settings.snapshot()?, false))
}

#[tauri::command(rename_all = "camelCase")]
pub fn shell_attention_set(
    app: AppHandle,
    settings: State<'_, Arc<SettingsState>>,
    show_unread_badge: Option<bool>,
    notify_new_articles: Option<bool>,
) -> Result<AttentionStatus, String> {
    let mut notify = notify_new_articles;
    let mut blocked = false;
    // Ask the system only when the user turns notifications on.
    if notify == Some(true) {
        use tauri::plugin::PermissionState;
        use tauri_plugin_notification::NotificationExt;
        let granted = matches!(app.notification().request_permission(), Ok(PermissionState::Granted));
        if !granted {
            notify = None;
            blocked = true;
        }
    }
    let updated = settings.set_attention(show_unread_badge, notify)?;
    if show_unread_badge.is_some() {
        request_badge_refresh(&app);
    }
    Ok(status(&updated, blocked))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn news(title: &str, inserted: i64) -> CycleFeedNews {
        CycleFeedNews { title: title.to_string(), inserted, first_fetch: false, boosted: false, forced: false }
    }

    #[test]
    fn badge_clears_at_zero_and_when_turned_off() {
        assert_eq!(badge_value(true, 12), Some(12));
        assert_eq!(badge_value(true, 0), None);
        assert_eq!(badge_value(false, 12), None);
    }

    #[test]
    fn counts_each_unread_story_once_from_the_read_index() {
        let mut connection = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&mut connection).unwrap();
        connection
            .execute_batch(
                "INSERT INTO feeds (id, title, url, created_at) VALUES ('f', 'F', 'u', '2026-01-01T00:00:00Z');
                 INSERT INTO articles (hash, feed_id, fetched_date, read) VALUES
                   ('a', 'f', '2026-01-01', 0), ('b', 'f', '2026-01-01', 0), ('c', 'f', '2026-01-01', 1);",
            )
            .unwrap();
        assert_eq!(count_unread_articles(&connection).unwrap(), 2);

        let plan: Vec<String> = connection
            .prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM articles WHERE read = 0")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(3))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let plan = plan.join(" | ");
        assert!(plan.contains("COVERING INDEX idx_articles_read"), "plan: {plan}");
    }

    #[test]
    fn summary_names_two_feeds_then_counts_the_rest() {
        let summary = summarize_cycle(&[
            news("Daring Fireball", 3),
            news("The Verge", 5),
            news("Six Colors", 2),
            news("Stratechery", 1),
            news("Kottke", 1),
        ])
        .unwrap();
        assert_eq!(summary.total, 12);
        assert_eq!(summary_text(&summary), "12 new articles from The Verge, Daring Fireball and 3 more");
    }

    #[test]
    fn summary_text_for_one_two_and_three_feeds() {
        let one = summarize_cycle(&[news("The Verge", 1)]).unwrap();
        assert_eq!(summary_text(&one), "1 new article from The Verge");
        let two = summarize_cycle(&[news("A", 2), news("B", 1)]).unwrap();
        assert_eq!(summary_text(&two), "3 new articles from A and B");
        let three = summarize_cycle(&[news("A", 3), news("B", 2), news("C", 1)]).unwrap();
        assert_eq!(summary_text(&three), "6 new articles from A, B and C");
        let untitled = summarize_cycle(&[news("  ", 2)]).unwrap();
        assert_eq!(summary_text(&untitled), "2 new articles from an untitled feed");
    }

    #[test]
    fn first_fetch_import_boost_and_manual_refresh_are_not_announced() {
        let first = CycleFeedNews { first_fetch: true, ..news("New feed", 40) };
        let boosted = CycleFeedNews { boosted: true, ..news("Imported", 25) };
        let forced = CycleFeedNews { forced: true, ..news("Refreshed", 3) };
        assert_eq!(summarize_cycle(&[first.clone(), boosted.clone(), forced.clone()]), None);
        assert_eq!(summarize_cycle(&[]), None);
        assert_eq!(summarize_cycle(&[news("Empty", 0)]), None);

        let summary = summarize_cycle(&[first, boosted, forced, news("Old friend", 2)]).unwrap();
        assert_eq!(summary.total, 2);
        assert_eq!(summary.feed_titles, vec!["Old friend".to_string()]);
    }

    #[test]
    fn notifies_only_when_on_background_and_unfocused() {
        assert!(should_notify(true, true, false));
        assert!(!should_notify(false, true, false), "setting off");
        assert!(!should_notify(true, false, false), "feed switch / manual refresh");
        assert!(!should_notify(true, true, true), "a KiJi window is focused");
    }

    #[test]
    fn activation_after_a_notification_brings_back_a_hidden_window() {
        assert!(should_show_main_on_activate(true, false, false));
        assert!(should_show_main_on_activate(true, true, true));
        assert!(!should_show_main_on_activate(true, true, false));
        assert!(!should_show_main_on_activate(false, false, false));
    }

    #[test]
    fn every_committed_write_wakes_the_badge() {
        use std::sync::atomic::AtomicUsize;
        let db = DbState::for_tests(Connection::open_in_memory().unwrap());
        let commits = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&commits);
        db.set_commit_listener(move || {
            counter.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap();
        db.with_writer(|connection| {
            connection
                .execute_batch("CREATE TABLE t (x); BEGIN; INSERT INTO t VALUES (1); INSERT INTO t VALUES (2); COMMIT;")
                .map_err(|error| error.to_string())
        })
        .unwrap();
        // CREATE (autocommit) + one explicit transaction.
        assert_eq!(commits.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn wakes_coalesce_into_one_pending_pass() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap();
        rt.block_on(async {
            let state = AttentionState::default();
            for _ in 0..500 {
                state.request_refresh();
            }
            // One stored permit: the first wait returns at once…
            tokio::time::timeout(Duration::from_millis(50), state.wake.notified())
                .await
                .expect("a wake is pending");
            // …and the burst left nothing else queued.
            assert!(tokio::time::timeout(Duration::from_millis(50), state.wake.notified())
                .await
                .is_err());
        });
    }
}
