use super::state::{MainProcessSnapshot, PerformanceSnapshot, ProcessSnapshot, timestamp};
use sysinfo::{Pid, ProcessesToUpdate, System};

#[tauri::command]
pub fn diagnostics_performance_snapshot() -> Result<PerformanceSnapshot, String> {
    Ok(capture_performance_snapshot())
}

pub fn capture_performance_snapshot() -> PerformanceSnapshot {
    let pid = std::process::id();
    let current_pid = Pid::from_u32(pid);
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&[current_pid]), true);

    let current_process = system.process(current_pid);
    let rss_mb = current_process
        .map(|process| bytes_to_mb(process.memory()))
        .unwrap_or(0.0);
    let cpu = current_process
        .map(|process| f64::from(process.cpu_usage()))
        .unwrap_or(0.0);

    PerformanceSnapshot {
        timestamp: timestamp(),
        processes: vec![ProcessSnapshot {
            pid,
            process_type: "native".to_string(),
            cpu,
            memory_mb: rss_mb,
        }],
        main: MainProcessSnapshot {
            pid,
            rss_mb,
            heap_used_mb: 0.0,
            heap_total_mb: 0.0,
            external_mb: 0.0,
            handles: 0,
            requests: 0,
        },
    }
}

fn bytes_to_mb(bytes: u64) -> f64 {
    (bytes as f64 / 1024.0 / 1024.0 * 10.0).round() / 10.0
}
