import { afterEach, describe, expect, it } from 'vitest';
import {
  getSchedulerConcurrency,
  getSchedulerRuntimeUiState,
  setSchedulerRuntimeUiState,
} from '@/services/scheduler/schedulerConcurrency';

describe('schedulerConcurrency', () => {
  afterEach(() => {
    setSchedulerRuntimeUiState({
      scrollActive: false,
      articleViewOpen: false,
    });
  });

  it('reduces concurrency while scrolling or article view is open', () => {
    const baseline = getSchedulerConcurrency();

    setSchedulerRuntimeUiState({ scrollActive: true });
    expect(getSchedulerConcurrency()).toBeLessThanOrEqual(3);
    expect(getSchedulerConcurrency()).toBeLessThan(baseline);

    setSchedulerRuntimeUiState({ scrollActive: false, articleViewOpen: true });
    expect(getSchedulerConcurrency()).toBeLessThanOrEqual(3);
  });

  it('merges partial runtime ui state patches', () => {
    setSchedulerRuntimeUiState({ scrollActive: true });
    expect(getSchedulerRuntimeUiState()).toEqual({
      scrollActive: true,
      articleViewOpen: false,
    });

    setSchedulerRuntimeUiState({ articleViewOpen: true });
    expect(getSchedulerRuntimeUiState()).toEqual({
      scrollActive: true,
      articleViewOpen: true,
    });
  });
});
