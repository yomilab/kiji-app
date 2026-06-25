use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerFeedEntry {
    pub feed_id: String,
    pub feed_url: String,
    pub feed_title: String,
    pub last_fetched_ms: Option<i64>,
    pub last_failed_fetch_at_ms: Option<i64>,
    pub sort_order: i64,
    pub update_frequency_score: f64,
    pub consecutive_failures: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedPriorityEntry {
    #[serde(flatten)]
    pub entry: SchedulerFeedEntry,
    pub score: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerRunPlan {
    pub prioritized: Vec<FeedPriorityEntry>,
    pub skipped_backoff_count: usize,
    pub skipped_suppressed_count: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerRunPlanOptions {
    pub frontload_feed_ids: Option<Vec<String>>,
    pub skip_feed_ids_for_this_cycle: Option<Vec<String>>,
    pub only_feed_ids: Option<Vec<String>>,
    pub exclude_feed_ids: Option<Vec<String>>,
    pub force_refresh_feed_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerBoost {
    pub feed_id: String,
    pub boost_until_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerCreateRunPlanRequest {
    pub entries: Vec<SchedulerFeedEntry>,
    pub boosts: Vec<SchedulerBoost>,
    pub now_ms: Option<i64>,
    pub options: Option<SchedulerRunPlanOptions>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerNativeCyclePreviewRequest {
    pub boosts: Vec<SchedulerBoost>,
    pub now_ms: Option<i64>,
    pub options: Option<SchedulerRunPlanOptions>,
    pub max_feeds: Option<usize>,
    pub concurrency: Option<usize>,
    pub execute: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerNativeCycleFeedResult {
    pub feed_id: String,
    pub status: String,
    pub inserted_count: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerNativeCyclePreviewResponse {
    pub plan: SchedulerRunPlan,
    pub queued_count: usize,
    pub executed_feed_count: usize,
    pub changed_feeds: usize,
    pub not_modified_feeds: usize,
    pub failed_feeds: usize,
    pub inserted_articles: i64,
    pub feed_results: Vec<SchedulerNativeCycleFeedResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerNativeCycleStartPayload {
    pub queued_count: usize,
    pub feed_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerNativeCycleFeedPayload {
    pub feed_id: String,
    pub inserted_count: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerNativeCycleCompletePayload {
    pub queued_count: usize,
    pub changed_feeds: usize,
    pub not_modified_feeds: usize,
    pub failed_feeds: usize,
    pub inserted_articles: i64,
}

pub const SCHEDULER_NATIVE_CYCLE_START_EVENT: &str = "scheduler:native-cycle-start";
pub const SCHEDULER_NATIVE_CYCLE_FEED_EVENT: &str = "scheduler:native-cycle-feed";
pub const SCHEDULER_NATIVE_CYCLE_COMPLETE_EVENT: &str = "scheduler:native-cycle-complete";
