use crate::settings::BackgroundUpdateMode;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::watch;

const MAIN_WINDOW_LABEL: &str = "main";
pub const SCHEDULER_CYCLE_TICK_EVENT: &str = "scheduler:cycle-tick";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SchedulerStartOutcome {
    Started,
    AlreadyRunning,
}

pub struct FeedSchedulerState {
    operation: Mutex<()>,
    generation: AtomicU64,
    active_loop_generation: AtomicU64,
    mode: Mutex<BackgroundUpdateMode>,
    shutdown_tx: Mutex<Option<watch::Sender<bool>>>,
}

impl FeedSchedulerState {
    pub fn new() -> Self {
        Self {
            operation: Mutex::new(()),
            generation: AtomicU64::new(0),
            active_loop_generation: AtomicU64::new(0),
            mode: Mutex::new(BackgroundUpdateMode::default()),
            shutdown_tx: Mutex::new(None),
        }
    }

    fn start(
        self: &Arc<Self>,
        app: AppHandle,
        mode: BackgroundUpdateMode,
    ) -> Result<SchedulerStartOutcome, String> {
        let _operation_guard = self
            .operation
            .lock()
            .map_err(|error| format!("Scheduler lock poisoned: {error}"))?;

        if self.is_running() {
            let current_mode = self
                .mode
                .lock()
                .map_err(|error| format!("Scheduler lock poisoned: {error}"))?;
            if *current_mode == mode {
                return Ok(SchedulerStartOutcome::AlreadyRunning);
            }
        }

        self.stop_inner()?;
        {
            let mut mode_guard = self
                .mode
                .lock()
                .map_err(|error| format!("Scheduler lock poisoned: {error}"))?;
            *mode_guard = mode;
        }

        if mode == BackgroundUpdateMode::Never {
            return Ok(SchedulerStartOutcome::Started);
        }

        if mode == BackgroundUpdateMode::OnLaunch {
            emit_cycle_tick(&app)?;
            return Ok(SchedulerStartOutcome::Started);
        }

        let interval_ms = interval_ms_for_mode(mode)?;
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        {
            let mut shutdown_guard = self
                .shutdown_tx
                .lock()
                .map_err(|error| format!("Scheduler lock poisoned: {error}"))?;
            *shutdown_guard = Some(shutdown_tx);
        }

        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.active_loop_generation
            .store(generation, Ordering::SeqCst);

        let state = Arc::clone(self);
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            run_interval_loop(state, app_handle, shutdown_rx, interval_ms, generation).await;
        });

        Ok(SchedulerStartOutcome::Started)
    }

    pub(crate) fn stop(&self) -> Result<(), String> {
        let _operation_guard = self
            .operation
            .lock()
            .map_err(|error| format!("Scheduler lock poisoned: {error}"))?;
        self.stop_inner()
    }

    fn reconfigure(
        self: &Arc<Self>,
        app: AppHandle,
        mode: BackgroundUpdateMode,
    ) -> Result<(), String> {
        match self.start(app, mode)? {
            SchedulerStartOutcome::Started | SchedulerStartOutcome::AlreadyRunning => Ok(()),
        }
    }

    fn is_running(&self) -> bool {
        self.shutdown_tx
            .lock()
            .ok()
            .is_some_and(|guard| guard.is_some())
    }

    fn stop_inner(&self) -> Result<(), String> {
        let mut shutdown_guard = self
            .shutdown_tx
            .lock()
            .map_err(|error| format!("Scheduler lock poisoned: {error}"))?;
        if let Some(shutdown_tx) = shutdown_guard.take() {
            let _ = shutdown_tx.send(true);
        }
        Ok(())
    }

    fn on_loop_exited(&self, generation: u64) {
        if self.active_loop_generation.load(Ordering::SeqCst) != generation {
            return;
        }

        if let Ok(mut shutdown_guard) = self.shutdown_tx.lock() {
            shutdown_guard.take();
        }
    }
}

async fn run_interval_loop(
    state: Arc<FeedSchedulerState>,
    app: AppHandle,
    mut shutdown_rx: watch::Receiver<bool>,
    interval_ms: u64,
    generation: u64,
) {
    loop {
        tokio::select! {
            changed = shutdown_rx.changed() => {
                if changed.is_err() || *shutdown_rx.borrow() {
                    break;
                }
            }
            _ = tokio::time::sleep(Duration::from_millis(interval_ms)) => {
                if emit_cycle_tick(&app).is_err() {
                    break;
                }
            }
        }
    }

    state.on_loop_exited(generation);
}

fn emit_cycle_tick(app: &AppHandle) -> Result<(), String> {
    if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        main_window
            .emit(SCHEDULER_CYCLE_TICK_EVENT, ())
            .map_err(|error| format!("Failed to emit scheduler tick: {error}"))?;
        return Ok(());
    }

    app.emit(SCHEDULER_CYCLE_TICK_EVENT, ())
        .map_err(|error| format!("Failed to emit scheduler tick: {error}"))
}

fn interval_ms_for_mode(mode: BackgroundUpdateMode) -> Result<u64, String> {
    Ok(match mode {
        BackgroundUpdateMode::Every5Minutes => 5 * 60_000,
        BackgroundUpdateMode::Every10Minutes => 10 * 60_000,
        BackgroundUpdateMode::Every15Minutes => 15 * 60_000,
        BackgroundUpdateMode::Every30Minutes => 30 * 60_000,
        BackgroundUpdateMode::EveryHour => 60 * 60_000,
        BackgroundUpdateMode::OnLaunch | BackgroundUpdateMode::Never => {
            return Err("Interval mode required".to_string());
        }
    })
}

#[tauri::command]
pub fn scheduler_start(
    app: AppHandle,
    state: tauri::State<'_, Arc<FeedSchedulerState>>,
    mode: BackgroundUpdateMode,
) -> Result<String, String> {
    match state.start(app, mode)? {
        SchedulerStartOutcome::Started => Ok("started".to_string()),
        SchedulerStartOutcome::AlreadyRunning => Ok("already-running".to_string()),
    }
}

#[tauri::command]
pub fn scheduler_stop(state: tauri::State<'_, Arc<FeedSchedulerState>>) -> Result<(), String> {
    state.stop()
}

#[tauri::command]
pub fn scheduler_reconfigure(
    app: AppHandle,
    state: tauri::State<'_, Arc<FeedSchedulerState>>,
    mode: BackgroundUpdateMode,
) -> Result<(), String> {
    state.reconfigure(app, mode)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_interval_modes_to_milliseconds() {
        assert_eq!(
            interval_ms_for_mode(BackgroundUpdateMode::Every5Minutes).expect("every-5m"),
            300_000
        );
        assert_eq!(
            interval_ms_for_mode(BackgroundUpdateMode::EveryHour).expect("every-1h"),
            3_600_000
        );
        assert!(interval_ms_for_mode(BackgroundUpdateMode::Never).is_err());
    }

    #[test]
    fn clears_running_state_when_loop_exits() {
        let state = FeedSchedulerState::new();
        let (shutdown_tx, _shutdown_rx) = watch::channel(false);
        state.active_loop_generation.store(7, Ordering::SeqCst);
        *state.shutdown_tx.lock().expect("lock") = Some(shutdown_tx);

        assert!(state.is_running());

        state.on_loop_exited(7);

        assert!(!state.is_running());
    }

    #[test]
    fn ignores_stale_loop_exit_for_newer_generation() {
        let state = FeedSchedulerState::new();
        let (shutdown_tx, _shutdown_rx) = watch::channel(false);
        state.active_loop_generation.store(9, Ordering::SeqCst);
        *state.shutdown_tx.lock().expect("lock") = Some(shutdown_tx);

        state.on_loop_exited(8);

        assert!(state.is_running());
    }
}
