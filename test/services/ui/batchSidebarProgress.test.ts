import { beforeEach, describe, expect, it, vi } from 'vitest';

const show = vi.hoisted(() => vi.fn());

vi.mock('@/services/ui/sidebarIndicatorService', () => ({
  sidebarIndicatorService: {
    show,
    clear: vi.fn(),
  },
}));

import { runWithSidebarBatchProgress } from '@/services/ui/batchSidebarProgress';

describe('runWithSidebarBatchProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports start and completion progress for batch work', async () => {
    const result = await runWithSidebarBatchProgress('clearing', 4, async (reportProgress) => {
      reportProgress(1);
      reportProgress(2);
      reportProgress(4);
      return 'done';
    });

    expect(result).toBe('done');
    expect(show).toHaveBeenCalledWith('Clearing 0/4');
    expect(show).toHaveBeenCalledWith('Clearing 4/4');
  });
});
