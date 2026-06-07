use super::snapshot::capture_performance_snapshot;
use super::state::DiagnosticsState;
use serde_json::json;
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const HEARTBEAT_INTERVAL_MS: u64 = 250;
const SUSPEND_STALL_THRESHOLD_MS: u64 = 120_000;
const FREEZE_THRESHOLD_MS: u64 = 1_000;
const BEACHBALL_THRESHOLD_MS: u64 = 2_000;
const SEVERE_THRESHOLD_MS: u64 = 5_000;

static LAST_HEARTBEAT_MS: AtomicU64 = AtomicU64::new(0);

pub fn start(state: Arc<DiagnosticsState>) {
    tauri::async_runtime::spawn(async {
        loop {
            touch_heartbeat();
            tokio::time::sleep(Duration::from_millis(HEARTBEAT_INTERVAL_MS)).await;
        }
    });

    std::thread::spawn(move || {
        let mut last_reported_stall_ms = 0_u64;
        loop {
            std::thread::sleep(Duration::from_millis(HEARTBEAT_INTERVAL_MS));
            let stall_duration_ms =
                now_ms().saturating_sub(LAST_HEARTBEAT_MS.load(Ordering::Relaxed));
            if stall_duration_ms >= SUSPEND_STALL_THRESHOLD_MS {
                touch_heartbeat();
                last_reported_stall_ms = 0;
                continue;
            }
            let Some(severity) = classify_freeze_severity(stall_duration_ms) else {
                last_reported_stall_ms = 0;
                continue;
            };

            if stall_duration_ms <= last_reported_stall_ms.saturating_add(500) {
                continue;
            }

            last_reported_stall_ms = stall_duration_ms;
            let _ = state.log_internal(json!({
                "level": "warn",
                "process": "native",
                "category": "InteractionFreezeWatchdog",
                "event": "main-process-freeze-detected",
                "message": "Native process event-loop freeze detected",
                "context": {
                    "processRole": "native",
                    "severity": severity,
                    "stallDurationMs": stall_duration_ms,
                    "heartbeatIntervalMs": HEARTBEAT_INTERVAL_MS,
                    "activeOperations": [],
                    "recentOperations": [],
                    "performance": capture_performance_snapshot(),
                    "freezeDetected": true,
                    "requiresDebugging": true,
                },
            }));
        }
    });
}

fn touch_heartbeat() {
    LAST_HEARTBEAT_MS.store(now_ms(), Ordering::Relaxed);
}

fn classify_freeze_severity(stall_duration_ms: u64) -> Option<&'static str> {
    if stall_duration_ms >= SEVERE_THRESHOLD_MS {
        return Some("severe");
    }
    if stall_duration_ms >= BEACHBALL_THRESHOLD_MS {
        return Some("beachball");
    }
    if stall_duration_ms >= FREEZE_THRESHOLD_MS {
        return Some("freeze");
    }
    None
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
