import { describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(async () => ({ articles: [], total: 0, hasMore: false, cancelled: false })),
}));

vi.mock('@/lib/tauriClient', () => ({
  tauriClient: { articles: { query: queryMock } },
}));

import { query } from '@/stores/articleStore';

describe('articleStore.query Today', () => {
  it('forwards the Today flag so the 24-hour window is applied natively', async () => {
    await query({ today: true, limit: 50 });
    expect(queryMock).toHaveBeenCalledWith(expect.objectContaining({ today: true, limit: 50 }));
  });
});
