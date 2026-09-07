import { describe, expect, it, vi } from 'vitest';
import {
  enqueueLibraryReorder,
  supersedeNonLibraryReorderQueues,
  waitForNonLibraryReorderIdle,
  withNonLibraryImportLock,
} from '@/services/feeds/libraryReorderQueue';

describe('libraryReorderQueue', () => {
  it('runs only the latest queued write per list', async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    const inFlight = enqueueLibraryReorder('unstationed', async () => {
      await hold;
    });
    const superseded = enqueueLibraryReorder('unstationed', first);
    const latest = enqueueLibraryReorder('unstationed', second);

    await expect(superseded).rejects.toThrow('superseded');
    release();
    await inFlight;
    await latest;

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not supersede a library persist when import flushes other lists', async () => {
    const libraryWrite = vi.fn().mockResolvedValue(undefined);
    const libraryPersist = enqueueLibraryReorder('library', libraryWrite);
    supersedeNonLibraryReorderQueues();
    await waitForNonLibraryReorderIdle();
    await libraryPersist;
    expect(libraryWrite).toHaveBeenCalledTimes(1);
  });

  it('waits out in-flight non-library writes and rejects new ones during import', async () => {
    const inFlightWrite = vi.fn().mockResolvedValue(undefined);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inFlight = enqueueLibraryReorder('unstationed', async () => {
      await hold;
      await inFlightWrite();
    });
    const libraryWrite = vi.fn().mockResolvedValue(undefined);
    const libraryPersist = enqueueLibraryReorder('library', libraryWrite);

    let importRan = false;
    const importLock = withNonLibraryImportLock(async () => {
      importRan = true;
      await expect(enqueueLibraryReorder('unstationed', vi.fn())).rejects.toThrow('import');
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(importRan).toBe(false);
    release();
    await inFlight;
    await importLock;
    await libraryPersist;

    expect(inFlightWrite).toHaveBeenCalledTimes(1);
    expect(importRan).toBe(true);
    expect(libraryWrite).toHaveBeenCalledTimes(1);
  });

  it('rejects a drop that arrives while waiting for an in-flight persist', async () => {
    const writeA = vi.fn();
    const writeB = vi.fn();
    let releaseA!: () => void;
    const holdA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const inFlightA = enqueueLibraryReorder('stations', async () => {
      await holdA;
      writeA();
    });

    let importWrote = false;
    const importLock = withNonLibraryImportLock(async () => {
      importWrote = true;
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    await expect(enqueueLibraryReorder('unstationed', writeB)).rejects.toThrow('import');

    releaseA();
    await inFlightA;
    await importLock;

    expect(writeA).toHaveBeenCalledTimes(1);
    expect(writeB).not.toHaveBeenCalled();
    expect(importWrote).toBe(true);
  });

  it('skips side effects from an in-flight write after a newer generation is queued', async () => {
    const published: string[] = [];
    let releaseFirst!: () => void;
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = enqueueLibraryReorder('unstationed', async ({ isCurrent }) => {
      await holdFirst;
      if (!isCurrent()) {
        return;
      }
      published.push('first');
    });
    const second = enqueueLibraryReorder('unstationed', async ({ isCurrent }) => {
      if (!isCurrent()) {
        return;
      }
      published.push('second');
    });

    releaseFirst();
    await first;
    await second;

    expect(published).toEqual(['second']);
  });
});
