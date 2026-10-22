use crate::db::{
    get_feeds_by_ids, list_scheduler_feed_entries, update_feed, DbState, FeedRecord, FeedUpdate,
};
use crate::diagnostics::robustness::{record, record_many, RobustnessCounter};
use crate::feeds::{
    load_compiled_mute_rules, store_parsed_feed_content, CompiledMuteRules,
    StoreParsedFeedRequest,
};
use crate::net::{feeds_abort_request, fetch_with_cache, FeedFetchWithCacheRequest};
use crate::scheduler::run_plan::{
    boosts_to_map, create_scheduler_run_plan, scheduler_feed_entry_from_scheduler_row,
};
use crate::scheduler::types::{
    FeedPriorityEntry, SchedulerNativeCycleCompletePayload, SchedulerNativeCycleFeedPayload,
    SchedulerNativeCycleFeedResult, SchedulerNativeCyclePreviewRequest,
    SchedulerNativeCyclePreviewResponse, SchedulerNativeCycleStartPayload,
    SCHEDULER_NATIVE_CYCLE_COMPLETE_EVENT, SCHEDULER_NATIVE_CYCLE_FEED_EVENT,
    SCHEDULER_NATIVE_CYCLE_START_EVENT,
};
use crate::scheduler::webview_delivery::emit_scheduler_payload_to_main_webview;
use crate::shell::attention::{self, CycleFeedNews};
use futures_util::stream::{FuturesUnordered, StreamExt};
use once_cell::sync::Lazy;
use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

const DEFAULT_NATIVE_CYCLE_CONCURRENCY: usize = 3;
const MAX_NATIVE_CYCLE_CONCURRENCY: usize = 8;

struct ActiveNativeCycle {
    cancelled: bool,
    request_ids: Vec<String>,
}

static ACTIVE_CYCLES: Lazy<Mutex<HashMap<String, ActiveNativeCycle>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Cancel an in-flight native cycle: stop new chunks and abort registered fetches.
#[tauri::command(rename_all = "camelCase")]
pub fn scheduler_cancel_native_cycle(cycle_id: String) -> Result<(), String> {
    let request_ids = {
        let mut cycles = ACTIVE_CYCLES
            .lock()
            .map_err(|_| "Failed to lock native cycle registry.".to_string())?;
        if let Some(cycle) = cycles.get_mut(&cycle_id) {
            cycle.cancelled = true;
            cycle.request_ids.clone()
        } else {
            Vec::new()
        }
    };

    for request_id in request_ids {
        let _ = feeds_abort_request(request_id);
    }

    Ok(())
}

struct CycleRegistryGuard(Option<String>);

impl Drop for CycleRegistryGuard {
    fn drop(&mut self) {
        if let Some(cycle_id) = self.0.take() {
            unregister_cycle(&cycle_id);
        }
    }
}

fn register_cycle(cycle_id: &str) -> Result<(), String> {
    let mut cycles = ACTIVE_CYCLES
        .lock()
        .map_err(|_| "Failed to lock native cycle registry.".to_string())?;
    cycles.insert(
        cycle_id.to_string(),
        ActiveNativeCycle {
            cancelled: false,
            request_ids: Vec::new(),
        },
    );
    Ok(())
}

fn unregister_cycle(cycle_id: &str) {
    if let Ok(mut cycles) = ACTIVE_CYCLES.lock() {
        cycles.remove(cycle_id);
    }
}

fn is_cycle_cancelled(cycle_id: &str) -> bool {
    ACTIVE_CYCLES
        .lock()
        .ok()
        .and_then(|cycles| cycles.get(cycle_id).map(|cycle| cycle.cancelled))
        .unwrap_or(false)
}

fn register_request_id(cycle_id: &str, request_id: String) {
    let already_cancelled = {
        let Ok(mut cycles) = ACTIVE_CYCLES.lock() else {
            return;
        };
        let Some(cycle) = cycles.get_mut(cycle_id) else {
            return;
        };
        cycle.request_ids.push(request_id.clone());
        cycle.cancelled
    };
    // Cancel may have flipped between chunk check and register — abort immediately.
    if already_cancelled {
        let _ = feeds_abort_request(request_id);
    }
}

pub async fn preview_native_refresh_cycle(
    app: &AppHandle,
    db: &DbState,
    request: SchedulerNativeCyclePreviewRequest,
) -> Result<SchedulerNativeCyclePreviewResponse, String> {
    let now_ms = request.now_ms.unwrap_or_else(current_time_ms);
    let options = request.options.clone().unwrap_or_default();
    let boosts = boosts_to_map(request.boosts.clone());
    let execute = request.execute.unwrap_or(false);
    let concurrency = request
        .concurrency
        .unwrap_or(DEFAULT_NATIVE_CYCLE_CONCURRENCY)
        .clamp(1, MAX_NATIVE_CYCLE_CONCURRENCY);
    let cycle_id = request.cycle_id.clone();

    let _cycle_guard = if let Some(ref id) = cycle_id {
        register_cycle(id)?;
        CycleRegistryGuard(Some(id.clone()))
    } else {
        CycleRegistryGuard(None)
    };

    let entries = db
        .read(|connection| {
            let rows = list_scheduler_feed_entries(connection)?;
            Ok(rows
                .iter()
                .map(scheduler_feed_entry_from_scheduler_row)
                .collect::<Vec<_>>())
        })
        .await?;

    let plan = create_scheduler_run_plan(&entries, entries.len(), &boosts, now_ms, &options);

    let mut prioritized = plan.prioritized.clone();
    if let Some(max_feeds) = request.max_feeds {
        prioritized.truncate(max_feeds);
    }

    let queued_count = prioritized.len();
    let queued_feed_ids: Vec<String> = prioritized
        .iter()
        .map(|entry| entry.entry.feed_id.clone())
        .collect();
    if execute && queued_count > 0 {
        emit_scheduler_payload_to_main_webview(
            app,
            SCHEDULER_NATIVE_CYCLE_START_EVENT,
            &SchedulerNativeCycleStartPayload {
                queued_count,
                feed_ids: queued_feed_ids,
                cycle_id: cycle_id.clone(),
            },
            "Scheduler",
        );
    }

    let mut feed_results = Vec::new();
    let mut changed_feeds = 0usize;
    let mut not_modified_feeds = 0usize;
    let mut failed_feeds = 0usize;
    let mut inserted_articles = 0i64;
    let mut cancelled = false;
    let mut feed_news: Vec<CycleFeedNews> = Vec::new();

    if execute && queued_count > 0 {
        let force_refresh_feed_ids: HashSet<String> = options
            .force_refresh_feed_ids
            .clone()
            .unwrap_or_default()
            .into_iter()
            .collect();

        // Mute rules compile once per cycle, not per feed or article.
        let mute_rules = load_compiled_mute_rules(app, db).await;
        let mute_rules = &mute_rules;
        let force_refresh_feed_ids = &force_refresh_feed_ids;
        let boosts = &boosts;
        let feed_news = &mut feed_news;
        let cycle_id_ref = &cycle_id;
        // Sliding window: a slow or timing-out feed holds one slot only, and
        // each feed reports its FEED event as soon as it settles (the old
        // lock-step chunks waited for the slowest feed of every chunk).
        cancelled = drive_feed_window(
            &prioritized,
            concurrency,
            || {
                cycle_id_ref
                    .as_ref()
                    .is_some_and(|id| is_cycle_cancelled(id))
            },
            move |batch| {
                let batch_ids: Vec<String> = batch
                    .iter()
                    .map(|entry| entry.entry.feed_id.clone())
                    .collect();
                async move {
                    let feeds_by_id = db
                        .read(move |connection| get_feeds_by_ids(connection, &batch_ids))
                        .await?;
                    // Feeds deleted between planning and execution are skipped
                    // so one missing row cannot abort the rest of the cycle.
                    Ok(resolve_chunk_feeds(batch, &feeds_by_id))
                }
            },
            move |_entry, feed: FeedRecord| {
                let force_refresh = force_refresh_feed_ids.contains(&feed.id);
                let request_id = cycle_id_ref
                    .as_ref()
                    .map(|cid| format!("{}:{}", cid, feed.id));
                if let Some(cid) = cycle_id_ref.as_ref() {
                    if let Some(rid) = request_id.clone() {
                        register_request_id(cid, rid);
                    }
                }
                refresh_single_feed_native(db, feed, force_refresh, request_id, mute_rules.clone())
            },
            |entry, result: Result<NativeFeedRefreshOutcome, String>| {
                let request_id = cycle_id
                    .as_ref()
                    .map(|cid| format!("{}:{}", cid, entry.entry.feed_id));
                let feed_result = match result {
                    Ok(outcome) => {
                        match outcome.status.as_str() {
                            "changed" => changed_feeds += 1,
                            "not-modified" => not_modified_feeds += 1,
                            _ => {}
                        }
                        inserted_articles += outcome.inserted_count.unwrap_or(0);
                        if outcome.inserted_count.unwrap_or(0) > 0 {
                            let feed_id = &entry.entry.feed_id;
                            feed_news.push(CycleFeedNews {
                                title: entry.entry.feed_title.clone(),
                                inserted: outcome.inserted_count.unwrap_or(0),
                                first_fetch: entry.entry.last_fetched_ms.is_none(),
                                boosted: boosts.get(feed_id).is_some_and(|until| *until > now_ms),
                                forced: force_refresh_feed_ids.contains(feed_id),
                            });
                        }
                        SchedulerNativeCycleFeedResult {
                            feed_id: entry.entry.feed_id.clone(),
                            status: outcome.status,
                            inserted_count: outcome.inserted_count,
                            error: None,
                        }
                    }
                    Err(error) => {
                        failed_feeds += 1;
                        SchedulerNativeCycleFeedResult {
                            feed_id: entry.entry.feed_id.clone(),
                            status: "failed".to_string(),
                            inserted_count: None,
                            error: Some(error),
                        }
                    }
                };

                emit_scheduler_payload_to_main_webview(
                    app,
                    SCHEDULER_NATIVE_CYCLE_FEED_EVENT,
                    &SchedulerNativeCycleFeedPayload {
                        feed_id: feed_result.feed_id.clone(),
                        inserted_count: feed_result.inserted_count,
                        error: feed_result.error.clone(),
                        cycle_id: cycle_id.clone(),
                        request_id,
                    },
                    "Scheduler",
                );
                feed_results.push(feed_result);
            },
        )
        .await?;

        if !cancelled {
            if let Some(ref id) = cycle_id {
                cancelled = is_cycle_cancelled(id);
            }
        }

        emit_scheduler_payload_to_main_webview(
            app,
            SCHEDULER_NATIVE_CYCLE_COMPLETE_EVENT,
            &SchedulerNativeCycleCompletePayload {
                queued_count,
                changed_feeds,
                not_modified_feeds,
                failed_feeds,
                inserted_articles,
                cycle_id: cycle_id.clone(),
                cancelled: Some(cancelled),
            },
            "Scheduler",
        );

        // Inserts are committed even when the cycle was cancelled midway, and
        // the next cycle won't see them as new, so they still count.
        attention::after_refresh_cycle(app, request.background.unwrap_or(false), &feed_news);
    }

    Ok(SchedulerNativeCyclePreviewResponse {
        plan,
        queued_count,
        executed_feed_count: feed_results.len(),
        changed_feeds,
        not_modified_feeds,
        failed_feeds,
        inserted_articles,
        feed_results,
        cancelled: Some(cancelled),
        cycle_id,
    })
}

/// Runs `run` for every planned entry with at most `concurrency` feeds in
/// flight, starting the next feed as soon as any slot frees up. Feed rows are
/// looked up in batches of `concurrency` only when the window needs them (one
/// read per batch, rows still fresh at start time). `is_cancelled` is checked
/// before every lookup and feed start; `on_settled` runs as each feed
/// finishes. A lookup error stops new work, drains the in-flight feeds (so
/// their request registrations clean up), then returns the error. In-flight
/// feeds are not polled during a batch lookup; that read is one indexed query.
/// Returns `true` when cancellation stopped the window before every feed ran.
async fn drive_feed_window<'a, E, F, R, LookupFut, RunFut>(
    entries: &'a [E],
    concurrency: usize,
    is_cancelled: impl Fn() -> bool,
    mut lookup: impl FnMut(&'a [E]) -> LookupFut,
    mut run: impl FnMut(&'a E, F) -> RunFut,
    mut on_settled: impl FnMut(&'a E, R),
) -> Result<bool, String>
where
    LookupFut: Future<Output = Result<Vec<(&'a E, F)>, String>>,
    RunFut: Future<Output = R>,
{
    let concurrency = concurrency.max(1);
    let mut next_batch_start = 0usize;
    let mut ready: VecDeque<(&'a E, F)> = VecDeque::new();
    let mut in_flight = FuturesUnordered::new();
    let mut cancelled = false;
    let mut lookup_error: Option<String> = None;

    loop {
        while lookup_error.is_none() && !cancelled && in_flight.len() < concurrency {
            if ready.is_empty() && next_batch_start >= entries.len() {
                break;
            }
            if is_cancelled() {
                cancelled = true;
                break;
            }
            if let Some((entry, feed)) = ready.pop_front() {
                let task = run(entry, feed);
                in_flight.push(async move { (entry, task.await) });
                continue;
            }

            let batch_end = (next_batch_start + concurrency).min(entries.len());
            let batch = &entries[next_batch_start..batch_end];
            next_batch_start = batch_end;
            match lookup(batch).await {
                Ok(resolved) => ready.extend(resolved),
                Err(error) => lookup_error = Some(error),
            }
        }

        match in_flight.next().await {
            Some((entry, result)) => on_settled(entry, result),
            None => break,
        }
    }

    match lookup_error {
        Some(error) => Err(error),
        None => Ok(cancelled),
    }
}

struct NativeFeedRefreshOutcome {
    status: String,
    inserted_count: Option<i64>,
}

async fn refresh_single_feed_native(
    db: &DbState,
    feed: FeedRecord,
    force_refresh: bool,
    request_id: Option<String>,
    mute_rules: Option<Arc<CompiledMuteRules>>,
) -> Result<NativeFeedRefreshOutcome, String> {
    // A manual/forced refresh must bypass conditional GET so the server returns
    // 200 with a full body instead of a 304. The 60s cooldown + forceNetwork
    // bypass in the renderer prevents spamming, so stripping etag/last_modified
    // here is safe and makes Cmd+R actually re-fetch.
    let (etag, last_modified) = conditional_headers(&feed, force_refresh);
    let network = match fetch_with_cache(FeedFetchWithCacheRequest {
        url: feed.url.clone(),
        request_id,
        etag,
        last_modified,
        timeout: None,
    })
    .await
    {
        Ok(response) => response,
        Err(error) => {
            // A cycle cancel aborts in-flight requests; that is not a feed
            // failure and must not push a healthy feed into backoff.
            if classify_fetch_error(&error) {
                record_feed_failure(db, &feed, &error).await?;
            }
            return Err(error);
        }
    };

    if network.not_modified || network.data.is_none() {
        let feed_id = feed.id.clone();
        let update = success_feed_update(network.etag.clone(), network.last_modified.clone(), None);
        db.write(move |connection| update_feed(connection, &feed_id, update))
            .await?;

        return Ok(NativeFeedRefreshOutcome {
            status: "not-modified".to_string(),
            inserted_count: Some(0),
        });
    }

    let raw_text = network
        .data
        .ok_or_else(|| "Feed fetch returned empty body.".to_string())?;

    // Parsing runs on the blocking pool without the writer lock; only the
    // inserts + feed update + count sync take the writer, as ONE transaction
    // per feed. UI writes (mark read, star) never queue behind XML parsing or
    // the whole cycle, and a failed store leaves no partial state.
    let store_request = StoreParsedFeedRequest {
        feed_id: feed.id.clone(),
        feed_url: feed.url.clone(),
        raw_text,
        feed_title: Some(feed.title.clone()),
        feed_favicon: feed.favicon.clone(),
        feed_favicon_has_transparency: feed.favicon_has_transparency,
        feed_favicon_bg_light: feed.favicon_bg_light.clone(),
        feed_favicon_bg_dark: feed.favicon_bg_dark.clone(),
        feed_image: feed.image.clone(),
        etag: network.etag.clone(),
        last_modified: network.last_modified.clone(),
        last_fetched: Some(current_time_rfc3339()),
        previous_update_frequency_score: Some(feed.update_frequency_score),
    };
    let stored = match store_parsed_feed_content(db, store_request, mute_rules).await {
        Ok(response) => response,
        Err(error) => {
            record_feed_failure(db, &feed, &error).await?;
            return Err(error);
        }
    };

    Ok(NativeFeedRefreshOutcome {
        status: "changed".to_string(),
        inserted_count: Some(stored.inserted_count),
    })
}

/// Pairs each planned entry with its current feed row, dropping entries whose
/// feed no longer exists.
fn resolve_chunk_feeds<'a>(
    chunk: &'a [FeedPriorityEntry],
    feeds_by_id: &HashMap<String, FeedRecord>,
) -> Vec<(&'a FeedPriorityEntry, FeedRecord)> {
    let resolved: Vec<_> = chunk
        .iter()
        .filter_map(|entry| match feeds_by_id.get(&entry.entry.feed_id) {
            Some(feed) => Some((entry, feed.clone())),
            None => {
                eprintln!(
                    "[Scheduler] Skipping feed missing at execution time: {}",
                    entry.entry.feed_id
                );
                None
            }
        })
        .collect();
    record_many(
        RobustnessCounter::ChunkFeedsSkippedMissing,
        (chunk.len() - resolved.len()) as u64,
    );
    resolved
}

/// Decides whether a fetch error counts as a feed failure, recording the
/// cancel-not-failure invariant when it does not.
fn classify_fetch_error(error: &str) -> bool {
    let should_record = should_record_feed_failure(error);
    if !should_record {
        record(RobustnessCounter::FetchCancelledNotRecorded);
    }
    should_record
}

/// Fetch errors are `FeedCommandError` JSON; a `FEED_REQUEST_CANCELLED` code
/// means the cycle was cancelled, not that the feed failed.
fn should_record_feed_failure(error: &str) -> bool {
    let code = serde_json::from_str::<serde_json::Value>(error)
        .ok()
        .and_then(|value| value.get("code")?.as_str().map(str::to_string));
    code.as_deref() != Some("FEED_REQUEST_CANCELLED")
}

async fn record_feed_failure(db: &DbState, feed: &FeedRecord, error: &str) -> Result<(), String> {
    let _ = error;
    let feed_id = feed.id.clone();
    let consecutive_failures = feed.consecutive_failures;
    db.write(move |connection| {
        update_feed(
            connection,
            &feed_id,
            FeedUpdate {
                consecutive_failures: Some(consecutive_failures + 1),
                last_failed_fetch_at: Some(Some(current_time_rfc3339())),
                title: None,
                url: None,
                created_at: None,
                description: None,
                last_fetched: None,
                unread_count: None,
                article_count: None,
                tags: None,
                favicon: None,
                favicon_has_transparency: None,
                favicon_dominant_color: None,
                favicon_bg_light: None,
                favicon_bg_dark: None,
                favicon_fetch_failed: None,
                emoji: None,
                image: None,
                categories: None,
                language: None,
                is_podcast: None,
                podcast_metadata: None,
                reader_mode_enabled: None,
                etag: None,
                last_modified_header: None,
                sort_order: None,
                update_frequency_score: None,
                last_favicon_refresh: None,
            },
        )
    })
    .await
}

fn success_feed_update(
    etag: Option<String>,
    last_modified: Option<String>,
    update_frequency_score: Option<f64>,
) -> FeedUpdate {
    FeedUpdate {
        last_fetched: Some(Some(current_time_rfc3339())),
        last_failed_fetch_at: Some(None),
        consecutive_failures: Some(0),
        etag: etag.map(Some),
        last_modified_header: last_modified.map(Some),
        update_frequency_score,
        title: None,
        url: None,
        created_at: None,
        description: None,
        unread_count: None,
        article_count: None,
        tags: None,
        favicon: None,
        favicon_has_transparency: None,
        favicon_dominant_color: None,
        favicon_bg_light: None,
        favicon_bg_dark: None,
        favicon_fetch_failed: None,
        emoji: None,
        image: None,
        categories: None,
        language: None,
        is_podcast: None,
        podcast_metadata: None,
        reader_mode_enabled: None,
        sort_order: None,
        last_favicon_refresh: None,
    }
}

fn current_time_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn current_time_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Selects conditional GET headers for a native feed fetch. A forced refresh
/// strips `etag` / `last_modified` so the server returns 200 with a full body
/// instead of a 304 Not Modified.
fn conditional_headers(feed: &FeedRecord, force_refresh: bool) -> (Option<String>, Option<String>) {
    if force_refresh {
        (None, None)
    } else {
        (feed.etag.clone(), feed.last_modified_header.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{FeedRecord, SchedulerFeedRow};

    fn feed_with_headers(etag: Option<&str>, last_modified: Option<&str>) -> FeedRecord {
        FeedRecord {
            id: "feed-1".to_string(),
            title: "Test".to_string(),
            url: "https://example.com/feed.xml".to_string(),
            created_at: "2026-06-30T00:00:00Z".to_string(),
            description: None,
            last_fetched: None,
            last_failed_fetch_at: None,
            unread_count: 0,
            article_count: 0,
            tags: Vec::new(),
            favicon: None,
            favicon_has_transparency: None,
            favicon_dominant_color: None,
            favicon_bg_light: None,
            favicon_bg_dark: None,
            favicon_fetch_failed: false,
            emoji: None,
            image: None,
            categories: Vec::new(),
            language: None,
            is_podcast: false,
            podcast_metadata: None,
            reader_mode_enabled: false,
            etag: etag.map(str::to_string),
            last_modified_header: last_modified.map(str::to_string),
            sort_order: 0,
            update_frequency_score: 0.0,
            consecutive_failures: 0,
            last_favicon_refresh: None,
        }
    }

    #[test]
    fn clamps_native_cycle_concurrency_bounds() {
        assert_eq!(0usize.clamp(1, MAX_NATIVE_CYCLE_CONCURRENCY), 1);
        assert_eq!(
            99usize.clamp(1, MAX_NATIVE_CYCLE_CONCURRENCY),
            MAX_NATIVE_CYCLE_CONCURRENCY
        );
    }

    #[test]
    fn conditional_headers_passthrough_when_not_forced() {
        let feed = feed_with_headers(Some("\"abc\""), Some("Wed, 30 Jun 2026 02:00:00 GMT"));
        let (etag, last_modified) = conditional_headers(&feed, false);
        assert_eq!(etag.as_deref(), Some("\"abc\""));
        assert_eq!(
            last_modified.as_deref(),
            Some("Wed, 30 Jun 2026 02:00:00 GMT")
        );
    }

    #[test]
    fn conditional_headers_stripped_when_forced() {
        let feed = feed_with_headers(Some("\"abc\""), Some("Wed, 30 Jun 2026 02:00:00 GMT"));
        let (etag, last_modified) = conditional_headers(&feed, true);
        assert!(etag.is_none());
        assert!(last_modified.is_none());
    }

    #[test]
    fn conditional_headers_none_when_feed_has_none() {
        let feed = feed_with_headers(None, None);
        let (etag, last_modified) = conditional_headers(&feed, false);
        assert!(etag.is_none());
        assert!(last_modified.is_none());
    }

    #[test]
    fn scheduler_feed_row_maps_to_entry_fields() {
        let row = SchedulerFeedRow {
            id: "f1".to_string(),
            title: "Title".to_string(),
            url: "https://example.com/rss".to_string(),
            last_fetched: Some("2026-06-30T02:00:00.000Z".to_string()),
            last_failed_fetch_at: None,
            sort_order: 3,
            update_frequency_score: 1.5,
            consecutive_failures: 2,
        };
        let entry = scheduler_feed_entry_from_scheduler_row(&row);
        assert_eq!(entry.feed_id, "f1");
        assert_eq!(entry.feed_url, "https://example.com/rss");
        assert_eq!(entry.feed_title, "Title");
        assert_eq!(entry.sort_order, 3);
        assert_eq!(entry.update_frequency_score, 1.5);
        assert_eq!(entry.consecutive_failures, 2);
        assert!(entry.last_fetched_ms.is_some());
        assert!(entry.last_failed_fetch_at_ms.is_none());
    }

    #[test]
    fn cancelled_fetch_does_not_record_feed_failure() {
        let cancelled = r#"{"code":"FEED_REQUEST_CANCELLED","message":"Feed request was cancelled."}"#;
        assert!(!should_record_feed_failure(cancelled));
    }

    #[test]
    fn cancelled_fetch_records_cancel_counter_only() {
        use crate::diagnostics::robustness::snapshot;
        let cancelled = r#"{"code":"FEED_REQUEST_CANCELLED","message":"Feed request was cancelled."}"#;
        let before = snapshot().fetch_cancelled_not_recorded;
        assert!(!classify_fetch_error(cancelled));
        assert!(!classify_fetch_error(cancelled));
        let after_cancel = snapshot().fetch_cancelled_not_recorded;
        assert!(
            after_cancel >= before + 2,
            "each cancelled fetch must bump FetchCancelledNotRecorded"
        );
        assert!(classify_fetch_error(r#"{"code":"FEED_HTTP_STATUS"}"#));
    }

    #[test]
    fn other_fetch_errors_record_feed_failure() {
        let http = r#"{"code":"FEED_HTTP_STATUS","message":"HTTP request failed with status 404 Not Found.","httpStatus":404}"#;
        assert!(should_record_feed_failure(http));
        assert!(should_record_feed_failure("Feed request was cancelled."));
        assert!(should_record_feed_failure(""));
    }

    fn priority_entry(feed_id: &str) -> FeedPriorityEntry {
        let row = SchedulerFeedRow {
            id: feed_id.to_string(),
            title: "Title".to_string(),
            url: "https://example.com/rss".to_string(),
            last_fetched: None,
            last_failed_fetch_at: None,
            sort_order: 0,
            update_frequency_score: 0.0,
            consecutive_failures: 0,
        };
        FeedPriorityEntry {
            entry: scheduler_feed_entry_from_scheduler_row(&row),
            score: 0.0,
        }
    }

    #[test]
    fn resolve_chunk_feeds_skips_feeds_deleted_after_planning() {
        let chunk = vec![
            priority_entry("feed-1"),
            priority_entry("deleted"),
            priority_entry("feed-3"),
        ];
        let mut feeds_by_id = HashMap::new();
        for id in ["feed-1", "feed-3"] {
            let mut feed = feed_with_headers(None, None);
            feed.id = id.to_string();
            feeds_by_id.insert(id.to_string(), feed);
        }

        let resolved = resolve_chunk_feeds(&chunk, &feeds_by_id);
        let ids: Vec<_> = resolved
            .iter()
            .map(|(entry, feed)| (entry.entry.feed_id.as_str(), feed.id.as_str()))
            .collect();
        assert_eq!(ids, vec![("feed-1", "feed-1"), ("feed-3", "feed-3")]);
    }

    #[test]
    fn resolve_chunk_feeds_records_skipped_missing_count() {
        use crate::diagnostics::robustness::snapshot;
        let chunk = vec![
            priority_entry("gone-1"),
            priority_entry("feed-1"),
            priority_entry("gone-2"),
        ];
        let mut feeds_by_id = HashMap::new();
        feeds_by_id.insert("feed-1".to_string(), feed_with_headers(None, None));

        let before = snapshot().chunk_feeds_skipped_missing;
        let resolved = resolve_chunk_feeds(&chunk, &feeds_by_id);
        let after = snapshot().chunk_feeds_skipped_missing;
        assert_eq!(resolved.len(), 1);
        assert!(
            after >= before + 2,
            "two missing feeds must add 2 to ChunkFeedsSkippedMissing"
        );
    }

    // --- drive_feed_window ---------------------------------------------------

    use std::cell::{Cell, RefCell};
    use std::sync::Arc;
    use tokio::sync::Notify;

    async fn resolve_all<'a>(batch: &'a [&'static str]) -> Result<Vec<(&'a &'static str, ())>, String> {
        Ok(batch.iter().map(|id| (id, ())).collect())
    }

    #[tokio::test]
    async fn window_starts_next_feed_while_a_slow_feed_is_still_running() {
        // concurrency 2: "slow" only finishes after "d" settled. Lock-step
        // chunks would wait on "slow" before starting "c"/"d" and never finish.
        let ids = ["slow", "b", "c", "d"];
        let release_slow = Arc::new(Notify::new());
        let settled = RefCell::new(Vec::new());

        let outcome = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            drive_feed_window(
                &ids,
                2,
                || false,
                resolve_all,
                |id, ()| {
                    let release_slow = Arc::clone(&release_slow);
                    let id = *id;
                    async move {
                        if id == "slow" {
                            release_slow.notified().await;
                        } else {
                            tokio::task::yield_now().await;
                        }
                        id
                    }
                },
                |_, id| {
                    settled.borrow_mut().push(id);
                    if id == "d" {
                        release_slow.notify_one();
                    }
                },
            ),
        )
        .await
        .expect("sliding window must not wait for the slowest feed");

        assert_eq!(outcome, Ok(false));
        assert_eq!(*settled.borrow(), vec!["b", "c", "d", "slow"]);
    }

    #[tokio::test]
    async fn window_never_exceeds_concurrency() {
        let ids: Vec<&'static str> = vec!["a", "b", "c", "d", "e", "f", "g"];
        let running = Cell::new(0usize);
        let max_running = Cell::new(0usize);
        let settled = Cell::new(0usize);

        let outcome = drive_feed_window(
            &ids,
            3,
            || false,
            resolve_all,
            |_, ()| {
                running.set(running.get() + 1);
                max_running.set(max_running.get().max(running.get()));
                async {
                    tokio::task::yield_now().await;
                }
            },
            |_, ()| {
                running.set(running.get() - 1);
                settled.set(settled.get() + 1);
            },
        )
        .await;

        assert_eq!(outcome, Ok(false));
        assert_eq!(settled.get(), ids.len());
        assert_eq!(max_running.get(), 3);
    }

    #[tokio::test]
    async fn window_stops_starting_feeds_after_cancel_and_drains_in_flight() {
        let ids = ["a", "b", "c", "d", "e"];
        let cancelled = Cell::new(false);
        let started = RefCell::new(Vec::new());
        let settled = RefCell::new(Vec::new());

        let outcome = drive_feed_window(
            &ids,
            2,
            || cancelled.get(),
            resolve_all,
            |id, ()| {
                started.borrow_mut().push(*id);
                let id = *id;
                async move {
                    tokio::task::yield_now().await;
                    id
                }
            },
            |_, id| {
                settled.borrow_mut().push(id);
                cancelled.set(true);
            },
        )
        .await;

        assert_eq!(outcome, Ok(true));
        assert_eq!(*started.borrow(), vec!["a", "b"]);
        assert_eq!(settled.borrow().len(), 2, "in-flight feeds still settle after cancel");
    }

    #[tokio::test]
    async fn window_looks_up_rows_in_concurrency_sized_batches_and_skips_missing() {
        let ids = ["a", "gone", "c", "d", "e"];
        let lookups = RefCell::new(Vec::new());
        let ran = RefCell::new(Vec::new());

        let outcome = drive_feed_window(
            &ids,
            2,
            || false,
            |batch: &[&'static str]| {
                lookups.borrow_mut().push(batch.len());
                let resolved: Vec<_> = batch
                    .iter()
                    .filter(|id| **id != "gone")
                    .map(|id| (id, ()))
                    .collect();
                async move { Ok(resolved) }
            },
            |id, ()| {
                ran.borrow_mut().push(*id);
                async {}
            },
            |_, ()| {},
        )
        .await;

        assert_eq!(outcome, Ok(false));
        assert_eq!(*lookups.borrow(), vec![2, 2, 1]);
        assert_eq!(*ran.borrow(), vec!["a", "c", "d", "e"]);
    }

    #[tokio::test]
    async fn window_lookup_error_drains_in_flight_then_returns_error() {
        let ids = ["a", "b", "c", "d"];
        let lookup_calls = Cell::new(0usize);
        let settled = RefCell::new(Vec::new());

        let outcome = drive_feed_window(
            &ids,
            2,
            || false,
            |batch: &[&'static str]| {
                lookup_calls.set(lookup_calls.get() + 1);
                let result = if lookup_calls.get() == 1 {
                    Ok(batch.iter().map(|id| (id, ())).collect())
                } else {
                    Err("db read failed".to_string())
                };
                async move { result }
            },
            |id, ()| {
                let id = *id;
                async move {
                    tokio::task::yield_now().await;
                    id
                }
            },
            |_, id| settled.borrow_mut().push(id),
        )
        .await;

        assert_eq!(outcome, Err("db read failed".to_string()));
        let mut settled = settled.into_inner();
        settled.sort_unstable();
        assert_eq!(settled, vec!["a", "b"]);
        assert_eq!(lookup_calls.get(), 2);
    }

    #[tokio::test]
    async fn window_with_no_entries_does_nothing() {
        let ids: [&'static str; 0] = [];
        let outcome = drive_feed_window(
            &ids,
            4,
            || false,
            resolve_all,
            |_, ()| async {},
            |_, ()| panic!("no feed should settle"),
        )
        .await;
        assert_eq!(outcome, Ok(false));
    }
}
