export interface SchedulerRuntimeUiState {
  scrollActive: boolean;
  articleViewOpen: boolean;
}

const DEFAULT_RUNTIME_UI_STATE: SchedulerRuntimeUiState = {
  scrollActive: false,
  articleViewOpen: false,
};

let runtimeUiState: SchedulerRuntimeUiState = { ...DEFAULT_RUNTIME_UI_STATE };

export const setSchedulerRuntimeUiState = (
  patch: Partial<SchedulerRuntimeUiState>,
): void => {
  runtimeUiState = {
    ...runtimeUiState,
    ...patch,
  };
};

export const getSchedulerRuntimeUiState = (): SchedulerRuntimeUiState => ({
  ...runtimeUiState,
});

export const getSchedulerConcurrency = (): number => {
  const hardwareSlots = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 3;
  const base = Math.min(8, Math.max(3, hardwareSlots));

  if (runtimeUiState.scrollActive || runtimeUiState.articleViewOpen) {
    return Math.min(3, base);
  }

  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return base;
  }

  return base;
};
