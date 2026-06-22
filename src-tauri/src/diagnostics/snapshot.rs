use super::state::{
    timestamp, MainProcessSnapshot, PerformanceSnapshot, ProcessSnapshot, ResourceTotalsSnapshot,
};
use std::collections::HashSet;
use sysinfo::{Pid, Process, ProcessesToUpdate, System};

#[tauri::command]
pub fn diagnostics_performance_snapshot() -> Result<PerformanceSnapshot, String> {
    Ok(capture_performance_snapshot())
}

pub fn capture_performance_snapshot() -> PerformanceSnapshot {
    let mut system = System::new();
    capture_performance_snapshot_with_system(&mut system)
}

pub(crate) fn capture_performance_snapshot_with_system(system: &mut System) -> PerformanceSnapshot {
    let pid = std::process::id();
    let current_pid = Pid::from_u32(pid);
    system.refresh_processes(ProcessesToUpdate::All, true);

    let current_process = system.process(current_pid);
    let rss_mb = current_process
        .map(|process| bytes_to_mb(process.memory()))
        .unwrap_or(0.0);
    let related_native_pids = collect_related_native_pids(system, current_pid);
    let mut processes = system
        .processes()
        .iter()
        .filter_map(|(process_pid, process)| {
            process_snapshot_for(*process_pid, process, current_pid, &related_native_pids)
        })
        .collect::<Vec<_>>();
    processes.sort_by_key(|process| (process.process_type.clone(), process.pid));

    let totals = resource_totals(&processes);

    PerformanceSnapshot {
        timestamp: timestamp(),
        processes,
        totals,
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

fn process_snapshot_for(
    pid: Pid,
    process: &Process,
    current_pid: Pid,
    related_native_pids: &HashSet<Pid>,
) -> Option<ProcessSnapshot> {
    let name = process_name(process);
    let process_type = if pid == current_pid {
        "native".to_string()
    } else if related_native_pids.contains(&pid) {
        "native-helper".to_string()
    } else if let Some(webkit_type) = classify_webkit_process(&name, &process_command(process)) {
        webkit_type.to_string()
    } else {
        return None;
    };

    Some(ProcessSnapshot {
        pid: pid.as_u32(),
        name,
        process_type,
        cpu: round_one_decimal(f64::from(process.cpu_usage())),
        memory_mb: bytes_to_mb(process.memory()),
    })
}

fn collect_related_native_pids(system: &System, current_pid: Pid) -> HashSet<Pid> {
    system
        .processes()
        .keys()
        .copied()
        .filter(|pid| *pid != current_pid && has_parent_pid(system, *pid, current_pid))
        .collect()
}

fn has_parent_pid(system: &System, pid: Pid, expected_parent: Pid) -> bool {
    let mut seen = HashSet::new();
    let mut parent = system.process(pid).and_then(Process::parent);

    while let Some(parent_pid) = parent {
        if parent_pid == expected_parent {
            return true;
        }
        if !seen.insert(parent_pid) {
            return false;
        }
        parent = system.process(parent_pid).and_then(Process::parent);
    }

    false
}

fn classify_webkit_process(name: &str, command: &str) -> Option<&'static str> {
    let haystack = if command.is_empty() {
        name.to_string()
    } else {
        format!("{name} {command}")
    };
    if !haystack.contains("com.apple.WebKit.") && !haystack.contains("/WebKit.framework/") {
        return None;
    }

    if haystack.contains("com.apple.WebKit.WebContent") {
        Some("webkit-webcontent")
    } else if haystack.contains("com.apple.WebKit.Networking") {
        Some("webkit-networking")
    } else if haystack.contains("com.apple.WebKit.GPU") {
        Some("webkit-gpu")
    } else {
        Some("webkit")
    }
}

fn process_name(process: &Process) -> String {
    process.name().to_string_lossy().to_string()
}

fn process_command(process: &Process) -> String {
    process
        .cmd()
        .iter()
        .map(|part| part.to_string_lossy())
        .collect::<Vec<_>>()
        .join(" ")
}

fn resource_totals(processes: &[ProcessSnapshot]) -> ResourceTotalsSnapshot {
    ResourceTotalsSnapshot {
        cpu: round_one_decimal(processes.iter().map(|process| process.cpu).sum()),
        memory_mb: round_one_decimal(processes.iter().map(|process| process.memory_mb).sum()),
        native_memory_mb: round_one_decimal(
            processes
                .iter()
                .filter(|process| process.process_type.starts_with("native"))
                .map(|process| process.memory_mb)
                .sum(),
        ),
        webkit_memory_mb: round_one_decimal(
            processes
                .iter()
                .filter(|process| process.process_type.starts_with("webkit"))
                .map(|process| process.memory_mb)
                .sum(),
        ),
        process_count: processes.len(),
    }
}

fn bytes_to_mb(bytes: u64) -> f64 {
    (bytes as f64 / 1024.0 / 1024.0 * 10.0).round() / 10.0
}

fn round_one_decimal(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_webkit_xpc_processes() {
        assert_eq!(
            classify_webkit_process("com.apple.WebKit.WebContent", ""),
            Some("webkit-webcontent")
        );
        assert_eq!(
            classify_webkit_process(
                "",
                "/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.Networking.xpc/Contents/MacOS/com.apple.WebKit.Networking"
            ),
            Some("webkit-networking")
        );
        assert_eq!(
            classify_webkit_process("com.apple.WebKit.GPU", ""),
            Some("webkit-gpu")
        );
    }

    #[test]
    fn ignores_non_webkit_processes() {
        assert_eq!(classify_webkit_process("kiji-app", ""), None);
        assert_eq!(classify_webkit_process("Safari", ""), None);
    }

    #[test]
    fn sums_resource_totals_by_process_group() {
        let totals = resource_totals(&[
            ProcessSnapshot {
                pid: 1,
                name: "kiji-app".to_string(),
                process_type: "native".to_string(),
                cpu: 10.0,
                memory_mb: 100.0,
            },
            ProcessSnapshot {
                pid: 2,
                name: "com.apple.WebKit.WebContent".to_string(),
                process_type: "webkit-webcontent".to_string(),
                cpu: 5.0,
                memory_mb: 500.0,
            },
        ]);

        assert_eq!(totals.cpu, 15.0);
        assert_eq!(totals.memory_mb, 600.0);
        assert_eq!(totals.native_memory_mb, 100.0);
        assert_eq!(totals.webkit_memory_mb, 500.0);
        assert_eq!(totals.process_count, 2);
    }
}
