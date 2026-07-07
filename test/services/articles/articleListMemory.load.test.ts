import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearArticleListMemoryCaches,
  getInternedFeedMetadataCountForTests,
  removeArticleFeedMetadata,
} from '@/services/articles/articleListMemory';
import {
  LIBRARY_SCENARIO,
  TECH_STATION_SCENARIO,
  buildRealisticArticleRecordPage,
  countDistinctFaviconReferences,
  estimateInternedRetainedStringBytes,
  estimateRetainedStringBytes,
  loadArticleRecordsFromKiJiDb,
  loadTechStationRecordsFromKiJiDb,
  logLoadMemoryReport,
  measureGeneratedScrollLoadMemory,
  resolveOptionalKiJiDbPath,
  simulateGeneratedInfiniteScrollLoad,
  snapshotProcessMemory,
} from '../../helpers/articleListMemoryHarness';

const buildScrollOptions = (
  scenario: { feedCount: number; articleCount: number; pageSize: number },
  overrides: Partial<{ faviconSizeKb: number; uniqueFaviconPerRow: boolean }> = {},
) => ({
  feedCount: scenario.feedCount,
  articleCount: scenario.articleCount,
  pageSize: scenario.pageSize,
  faviconSizeKb: overrides.faviconSizeKb ?? 4,
  uniqueFaviconPerRow: overrides.uniqueFaviconPerRow ?? false,
});

describe('articleListMemory load + RAM scenarios', () => {
  beforeEach(() => {
    clearArticleListMemoryCaches();
  });

  it.each([
    ['Tech station', TECH_STATION_SCENARIO],
    ['Whole library', LIBRARY_SCENARIO],
  ])('%s paging keeps intern table bounded without loading all source rows upfront', (_label, scenario) => {
    const options = buildScrollOptions(scenario);
    const { result: loaded, peakHeapUsedMb } = simulateGeneratedInfiniteScrollLoad(
      options.articleCount,
      options.pageSize,
      'prepared',
      (offset, limit) => buildRealisticArticleRecordPage(offset, limit, options),
    );

    if (process.env.KIJI_MEMORY_TEST_REPORT === '1') {
      logLoadMemoryReport(`${_label}-scroll`, {
        ...snapshotProcessMemory(),
        heapDeltaMb: 0,
        rssDeltaMb: 0,
        peakHeapUsedMb,
        serializedRetainedKb: Math.round(
          JSON.stringify(loaded).length / 1024,
        ),
        estimatedStringBytes: estimateInternedRetainedStringBytes(loaded),
        articleCount: loaded.length,
        elapsedMs: 0,
        distinctFaviconRefs: countDistinctFaviconReferences(loaded),
        internedFeedCount: getInternedFeedMetadataCountForTests(),
      });
    }

    expect(loaded).toHaveLength(scenario.articleCount);
    expect(getInternedFeedMetadataCountForTests()).toBeLessThanOrEqual(Math.min(scenario.feedCount, 512));
    expect(countDistinctFaviconReferences(loaded)).toBeLessThanOrEqual(scenario.feedCount);
    expect(loaded.every((article) => article.images === undefined)).toBe(true);
    expect(peakHeapUsedMb).toBeGreaterThan(0);
  });

  it('measures lower heap/RSS for prepared scroll than naive at 1200 rows', () => {
    const options = buildScrollOptions(
      { feedCount: TECH_STATION_SCENARIO.feedCount, articleCount: 1200, pageSize: 100 },
      { faviconSizeKb: 8, uniqueFaviconPerRow: false },
    );

    clearArticleListMemoryCaches();
    const naiveMeasured = measureGeneratedScrollLoadMemory(
      options.articleCount,
      options.pageSize,
      'naive',
      (offset, limit) => buildRealisticArticleRecordPage(offset, limit, options),
      getInternedFeedMetadataCountForTests,
    );

    clearArticleListMemoryCaches();
    const preparedMeasured = measureGeneratedScrollLoadMemory(
      options.articleCount,
      options.pageSize,
      'prepared',
      (offset, limit) => buildRealisticArticleRecordPage(offset, limit, options),
      getInternedFeedMetadataCountForTests,
    );

    logLoadMemoryReport('naive-1200', naiveMeasured.memory);
    logLoadMemoryReport('prepared-1200', preparedMeasured.memory);

    const naive = naiveMeasured.result;
    const prepared = preparedMeasured.result;

    expect(naive).toHaveLength(1200);
    expect(prepared).toHaveLength(1200);
    expect(countDistinctFaviconReferences(naive)).toBeLessThanOrEqual(TECH_STATION_SCENARIO.feedCount);
    expect(preparedMeasured.memory.distinctFaviconRefs).toBeLessThanOrEqual(TECH_STATION_SCENARIO.feedCount);
    expect(estimateInternedRetainedStringBytes(prepared)).toBeLessThan(estimateRetainedStringBytes(naive) * 0.6);
    expect(preparedMeasured.memory.serializedRetainedKb).toBeLessThan(naiveMeasured.memory.serializedRetainedKb);
    expect(prepared.every((article) => article.images === undefined)).toBe(true);
    expect(naive.some((article) => article.images !== undefined)).toBe(true);
    expect(preparedMeasured.memory.peakHeapUsedMb).toBeGreaterThan(0);
    expect(naiveMeasured.memory.peakHeapUsedMb).toBeGreaterThan(0);
  });

  it('intern map evicts deleted feed metadata', () => {
    const options = buildScrollOptions({ feedCount: 400, articleCount: 800, pageSize: 100 }, { faviconSizeKb: 2 });
    simulateGeneratedInfiniteScrollLoad(
      options.articleCount,
      options.pageSize,
      'prepared',
      (offset, limit) => buildRealisticArticleRecordPage(offset, limit, options),
    );

    expect(getInternedFeedMetadataCountForTests()).toBe(400);
    removeArticleFeedMetadata('feed-0');
    expect(getInternedFeedMetadataCountForTests()).toBe(399);
  });
});

describe('articleListMemory optional KiJi DB RAM fixtures', () => {
  beforeEach(() => {
    clearArticleListMemoryCaches();
  });

  it.each([
    ['library', loadArticleRecordsFromKiJiDb, 1500, 1200],
    ['Tech station', loadTechStationRecordsFromKiJiDb, 2000, 1000],
  ])('measures RAM when loading real %s rows from kiji.db', (_label, loader, limit, minimumRows) => {
    const dbPath = resolveOptionalKiJiDbPath();
    if (!dbPath) {
      return;
    }

    let records: ReturnType<typeof loadArticleRecordsFromKiJiDb>;
    try {
      records = loader(dbPath, limit);
    } catch {
      return;
    }

    if (records.length < minimumRows) {
      return;
    }

    clearArticleListMemoryCaches();
    const measured = measureGeneratedScrollLoadMemory(
      records.length,
      100,
      'prepared',
      (offset, pageLimit) => records.slice(offset, offset + pageLimit),
      getInternedFeedMetadataCountForTests,
    );

    logLoadMemoryReport(`${_label}-db`, measured.memory);

    expect(measured.result.length).toBe(records.length);
    expect(measured.memory.heapUsedMb).toBeGreaterThan(0);
    expect(measured.memory.rssMb).toBeGreaterThan(0);
    expect(measured.memory.distinctFaviconRefs).toBeLessThan(records.length);
    expect(measured.memory.internedFeedCount).toBeLessThanOrEqual(512);
  });
});
