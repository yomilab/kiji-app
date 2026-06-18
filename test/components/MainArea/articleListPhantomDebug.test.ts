import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockInfo = vi.fn();

vi.mock('@/services/logger/logger', () => ({
  logger: {
    info: (...args: unknown[]) => mockInfo(...args),
  },
}));

import {
  logArticleListPhantomScroll,
  logArticleListPhantomState,
} from '@/components/MainArea/articleListPhantomDebug';

describe('articleListPhantomDebug', () => {
  beforeEach(() => {
    mockInfo.mockClear();
  });

  it('writes phantom state diagnostics to the app logger', () => {
    logArticleListPhantomState({ phantomRowCount: 6, mountedPhantomCount: 2 });

    expect(mockInfo).toHaveBeenCalledWith(
      'ArticleListPhantom',
      'phantom-state',
      { phantomRowCount: 6, mountedPhantomCount: 2 },
    );
  });

  it('writes near-bottom scroll diagnostics to the app logger', () => {
    logArticleListPhantomScroll({ distanceFromBottom: 120 });

    expect(mockInfo).toHaveBeenCalledWith(
      'ArticleListPhantom',
      'phantom-scroll-near-bottom',
      { distanceFromBottom: 120 },
    );
  });
});
