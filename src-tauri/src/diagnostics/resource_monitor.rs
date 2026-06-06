use super::state::DiagnosticsState;
use serde_json::json;
use std::{
    fs::OpenOptions,
    io::Write,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use sysinfo::{Disks, ProcessesToUpdate, System};

const MONITOR_INTERVAL_MS: u64 = 30_000;
const LOG_COOLDOWN_MS: u64 = 15 * 60 * 1_000;

const CPU_WARN: f64 = 120.0;
const CPU_ERROR: f64 = 200.0;
const MEMORY_WARN_MB: f64 = 1_000.0;
const MEMORY_ERROR_MB: f64 = 1_500.0;
const PROCESS_COUNT_WARN: usize = 15;
const PROCESS_COUNT_ERROR: usize = 20;
const DISK_FREE_WARN_GB: f64 = 2.0;
const DISK_FREE_ERROR_GB: f64 = 1.0;

pub fn start(state: Arc<DiagnosticsState>) {
    std::thread::spawn(move || {
        let mut last_logged_at_by_metric = [0_u64; 4];
        loop {
            if let Err(error) = sample_once(&state, &mut last_logged_at_by_metric) {
                eprintln!("[ResourceMonitor] Failed to capture resource snapshot: {error}");
            }
            std::thread::sleep(Duration::from_millis(MONITOR_INTERVAL_MS));
        }
    });
}

fn sample_once(
    state: &DiagnosticsState,
    last_logged_at_by_metric: &mut [u64; 4],
) -> Result<(), String> {
    let mut system = System::new();
    let pid = std::process::id();
    let current_pid = sysinfo::Pid::from_u32(pid);
    system.refresh_processes(ProcessesToUpdate::Some(&[current_pid]), true);

    let current = system
        .process(current_pid)
        .ok_or_else(|| "Failed to resolve the current process for resource monitoring.".to_string())?;

    let total_cpu_percent = f64::from(current.cpu_usage());
    let total_memory_mb = bytes_to_mb(current.memory());
    let process_count = system.processes().len();
    let storage_free_gb = read_primary_disk_free_gb();

    let timestamp = super::state::timestamp();
    let line = format!(
        "[{timestamp}] cpu={total_cpu_percent:.2}% memoryMb={total_memory_mb:.1} processCount={process_count} storageFreeGb={}\n",
        storage_free_gb
            .map(|value| format!("{value:.2}"))
            .unwrap_or_else(|| "null".to_string())
    );
    state.append_resource_usage_log(&line)?;

    let now_ms = now_ms();
    maybe_log_breach(
        state,
        last_logged_at_by_metric,
        0,
        "cpu",
        total_cpu_percent,
        CPU_WARN,
        CPU_ERROR,
        now_ms,
    )?;
    maybe_log_breach(
        state,
        last_logged_at_by_metric,
        1,
        "memory",
        total_memory_mb,
        MEMORY_WARN_MB,
        MEMORY_ERROR_MB,
        now_ms,
    )?;
    maybe_log_breach_usize(
        state,
        last_logged_at_by_metric,
        2,
        "processCount",
        process_count,
        PROCESS_COUNT_WARN,
        PROCESS_COUNT_ERROR,
        now_ms,
    )?;
    if let Some(free_gb) = storage_free_gb {
        maybe_log_breach_low(
            state,
            last_logged_at_by_metric,
            3,
            "diskFreeGb",
            free_gb,
            DISK_FREE_WARN_GB,
            DISK_FREE_ERROR_GB,
            now_ms,
        )?;
    }

    Ok(())
}

fn maybe_log_breach(
    state: &DiagnosticsState,
    last_logged_at_by_metric: &mut [u64; 4],
    index: usize,
    metric: &str,
    value: f64,
    warn_threshold: f64,
    error_threshold: f64,
    now_ms: u64,
) -> Result<(), String> {
    let severity = if value >= error_threshold {
        "error"
    } else if value >= warn_threshold {
        "warn"
    } else {
        return Ok(());
    };

    if now_ms.saturating_sub(last_logged_at_by_metric[index]) < LOG_COOLDOWN_MS {
        return Ok(());
    }

    last_logged_at_by_metric[index] = now_ms;
    state.log_internal(json!({
        "level": severity,
        "process": "native",
        "category": "ResourceMonitor",
        "event": "resource-threshold-breach",
        "message": format!("Resource threshold breached for {metric}"),
        "context": {
            "metric": metric,
            "value": value,
            "severity": severity,
        },
    }))
}

fn maybe_log_breach_usize(
    state: &DiagnosticsState,
    last_logged_at_by_metric: &mut [u64; 4],
    index: usize,
    metric: &str,
    value: usize,
    warn_threshold: usize,
    error_threshold: usize,
    now_ms: u64,
) -> Result<(), String> {
    maybe_log_breach(
        state,
        last_logged_at_by_metric,
        index,
        metric,
        value as f64,
        warn_threshold as f64,
        error_threshold as f64,
        now_ms,
    )
}

fn maybe_log_breach_low(
    state: &DiagnosticsState,
    last_logged_at_by_metric: &mut [u64; 4],
    index: usize,
    metric: &str,
    value: f64,
    warn_threshold: f64,
    error_threshold: f64,
    now_ms: u64,
) -> Result<(), String> {
    let severity = if value <= error_threshold {
        "error"
    } else if value <= warn_threshold {
        "warn"
    } else {
        return Ok(());
    };

    if now_ms.saturating_sub(last_logged_at_by_metric[index]) < LOG_COOLDOWN_MS {
        return Ok(());
    }

    last_logged_at_by_metric[index] = now_ms;
    state.log_internal(json!({
        "level": severity,
        "process": "native",
        "category": "ResourceMonitor",
        "event": "resource-threshold-breach",
        "message": format!("Resource threshold breached for {metric}"),
        "context": {
            "metric": metric,
            "value": value,
            "severity": severity,
        },
    }))
}

fn read_primary_disk_free_gb() -> Option<f64> {
    let disks = Disks::new_with_refreshed_list();
    disks
        .iter()
        .find(|disk| disk.mount_point().to_string_lossy() == "/")
        .or_else(|| disks.iter().next())
        .map(|disk| bytes_to_mb(disk.available_space()) / 1024.0)
}

fn bytes_to_mb(bytes: u64) -> f64 {
    bytes as f64 / 1024.0 / 1024.0
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

impl DiagnosticsState {
    pub(crate) fn append_resource_usage_log(&self, line: &str) -> Result<(), String> {
        let log_date = super::state::timestamp();
        let log_date = log_date.get(0..10).unwrap_or("unknown");
        let path = self.logs_dir().join(format!("resource-usage-{log_date}.log"));
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|error| format!("Failed to open resource usage log: {error}"))?;
        file.write_all(line.as_bytes())
            .map_err(|error| format!("Failed to write resource usage log: {error}"))
    }
}
