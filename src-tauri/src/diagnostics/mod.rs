mod export;
mod freeze_watchdog;
mod resource_monitor;
mod snapshot;
mod state;

pub use export::diagnostics_export_bundle;
pub use snapshot::diagnostics_performance_snapshot;
pub use state::{diagnostics_log_get_path, diagnostics_log_write_entry, DiagnosticsState};

use std::sync::Arc;

pub fn start_background_monitoring(state: Arc<DiagnosticsState>) {
    freeze_watchdog::start(Arc::clone(&state));
    resource_monitor::start(Arc::clone(&state));
}
