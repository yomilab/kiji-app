use crate::db::{list_feeds, update_feed, DbState, FeedRecord, FeedUpdate};
use crate::feeds::{store_parsed_feed_content, StoreParsedFeedRequest};
use crate::net::{fetch_with_cache, FeedFetchWithCacheRequest};
use crate::scheduler::run_plan::{
    boosts_to_map, create_scheduler_run_plan, scheduler_feed_entry_from_record,
};
use crate::scheduler::types::{
    SchedulerNativeCycleCompletePayload, SchedulerNativeCycleFeedPayload,
    SchedulerNativeCycleFeedResult, SchedulerNativeCyclePreviewRequest,
    SchedulerNativeCyclePreviewResponse, SchedulerNativeCycleStartPayload,
    SCHEDULER_NATIVE_CYCLE_COMPLETE_EVENT, SCHEDULER_NATIVE_CYCLE_FEED_EVENT,
    SCHEDULER_NATIVE_CYCLE_START_EVENT,
};
use crate::scheduler::webview_delivery::emit_scheduler_payload_to_main_webview;
use futures_util::future::join_all;
use std::collections::HashMap;
use tauri::AppHandle;

const DEFAULT_NATIVE_CYCLE_CONCURRENCY: usize = 3;
const MAX_NATIVE_CYCLE_CONCURRENCY: usize = 8;

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

    let (entries, feeds_by_id) = db.with_connection(|connection| {
        let feeds = list_feeds(connection)?;
        let feeds_by_id = feeds
            .iter()
            .map(|feed| (feed.id.clone(), feed.clone()))
            .collect::<HashMap<_, _>>();
        let entries = feeds
            .iter()
            .map(scheduler_feed_entry_from_record)
            .collect::<Vec<_>>();
        Ok((entries, feeds_by_id))
    })?;

    let plan = create_scheduler_run_plan(
        &entries,
        entries.len(),
        &boosts,
        now_ms,
        &options,
    );

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
            },
            "Scheduler",
        );
    }

    let mut feed_results = Vec::new();
    let mut changed_feeds = 0usize;
    let mut not_modified_feeds = 0usize;
    let mut failed_feeds = 0usize;
    let mut inserted_articles = 0i64;

    if execute && queued_count > 0 {
        let force_refresh_feed_ids = options.force_refresh_feed_ids.clone();
        for chunk in prioritized.chunks(concurrency) {
            let chunk_futures = chunk.iter().map(|entry| {
                let feed = feeds_by_id
                    .get(&entry.entry.feed_id)
                    .cloned()
                    .ok_or_else(|| format!("Feed not found: {}", entry.entry.feed_id))?;
                let force_refresh = force_refresh_feed_ids
                    .as_ref()
                    .map(|ids| ids.iter().any(|id| id == &feed.id))
                    .unwrap_or(false);
                Ok(refresh_single_feed_native(db, feed, force_refresh))
            });
            let chunk_tasks: Result<Vec<_>, String> = chunk_futures.collect();
            let chunk_tasks = chunk_tasks?;

            let chunk_results = join_all(chunk_tasks).await;
            for (entry, result) in chunk.iter().zip(chunk_results) {
                let feed_result = match result {
                    Ok(outcome) => {
                        match outcome.status.as_str() {
                            "changed" => changed_feeds += 1,
                            "not-modified" => not_modified_feeds += 1,
                            _ => {}
                        }
                        inserted_articles += outcome.inserted_count.unwrap_or(0);
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
                    },
                    "Scheduler",
                );
                feed_results.push(feed_result);
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
            },
            "Scheduler",
        );
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
    })
}

struct NativeFeedRefreshOutcome {
    status: String,
    inserted_count: Option<i64>,
}

async fn refresh_single_feed_native(
    db: &DbState,
    feed: FeedRecord,
    force_refresh: bool,
) -> Result<NativeFeedRefreshOutcome, String> {
    // A manual/forced refresh must bypass conditional GET so the server returns
    // 200 with a full body instead of a 304. The 60s cooldown + forceNetwork
    // bypass in the renderer prevents spamming, so stripping etag/last_modified
    // here is safe and makes Cmd+R actually re-fetch.
    let (etag, last_modified) = conditional_headers(&feed, force_refresh);
    let network = match fetch_with_cache(FeedFetchWithCacheRequest {
        url: feed.url.clone(),
        request_id: None,
        etag,
        last_modified,
        timeout: None,
    })
    .await
    {
        Ok(response) => response,
        Err(error) => {
            record_feed_failure(db, &feed, &error)?;
            return Err(error);
        }
    };

    if network.not_modified || network.data.is_none() {
        db.with_connection(|connection| {
            update_feed(
                connection,
                &feed.id,
                success_feed_update(
                    network.etag.clone(),
                    network.last_modified.clone(),
                    None,
                ),
            )
        })?;

        return Ok(NativeFeedRefreshOutcome {
            status: "not-modified".to_string(),
            inserted_count: Some(0),
        });
    }

    let raw_text = network
        .data
        .ok_or_else(|| "Feed fetch returned empty body.".to_string())?;

    let stored = match db.with_connection(|connection| {
        store_parsed_feed_content(
            connection,
            StoreParsedFeedRequest {
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
            },
        )
    }) {
        Ok(response) => response,
        Err(error) => {
            record_feed_failure(db, &feed, &error)?;
            return Err(error);
        }
    };

    Ok(NativeFeedRefreshOutcome {
        status: "changed".to_string(),
        inserted_count: Some(stored.inserted_count),
    })
}

fn record_feed_failure(db: &DbState, feed: &FeedRecord, error: &str) -> Result<(), String> {
    let _ = error;
    db.with_connection(|connection| {
        update_feed(
            connection,
            &feed.id,
            FeedUpdate {
                consecutive_failures: Some(feed.consecutive_failures + 1),
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
    use crate::db::FeedRecord;

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
}
