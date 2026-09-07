export type LibraryReorderListKey =
  | 'library'
  | 'stations'
  | 'unstationed'
  | `nested:${string}`;

export const LIBRARY_REORDER_SUPERSEDED = 'Library reorder was superseded.';
export const LIBRARY_REORDER_SUPERSEDED_BY_IMPORT = 'Library reorder was superseded by import.';

export const isLibraryReorderSupersededByImport = (error: unknown): boolean => (
  error instanceof Error && error.message === LIBRARY_REORDER_SUPERSEDED_BY_IMPORT
);

export const isLibraryReorderSuperseded = (error: unknown): boolean => (
  error instanceof Error && (
    error.message === LIBRARY_REORDER_SUPERSEDED
    || error.message === LIBRARY_REORDER_SUPERSEDED_BY_IMPORT
  )
);

export type LibraryReorderRunContext = {
  generation: number;
  isCurrent: () => boolean;
};

type QueuedWork = {
  generation: number;
  run: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

const generationByKey = new Map<LibraryReorderListKey, number>();
const queuedByKey = new Map<LibraryReorderListKey, QueuedWork>();
const inFlightByKey = new Map<LibraryReorderListKey, Promise<void>>();
let nonLibraryImportLock = false;
let nonLibraryImportLockCount = 0;

export const isNonLibraryImportLockHeld = (): boolean => nonLibraryImportLock;

const nextGeneration = (key: LibraryReorderListKey): number => {
  const next = (generationByKey.get(key) ?? 0) + 1;
  generationByKey.set(key, next);
  return next;
};

const drain = (key: LibraryReorderListKey): void => {
  if (inFlightByKey.has(key)) {
    return;
  }

  const queued = queuedByKey.get(key);
  if (!queued) {
    return;
  }

  queuedByKey.delete(key);
  if (queued.generation !== generationByKey.get(key)) {
    queued.reject(new Error(LIBRARY_REORDER_SUPERSEDED));
    drain(key);
    return;
  }

  const promise = queued
    .run()
    .then(queued.resolve, queued.reject)
    .finally(() => {
      inFlightByKey.delete(key);
      drain(key);
    });
  inFlightByKey.set(key, promise);
};

export const enqueueLibraryReorder = (
  key: LibraryReorderListKey,
  run: (ctx: LibraryReorderRunContext) => Promise<void>,
): Promise<void> => {
  if (nonLibraryImportLock && key !== 'library') {
    return Promise.reject(new Error(LIBRARY_REORDER_SUPERSEDED_BY_IMPORT));
  }

  const generation = nextGeneration(key);
  const previous = queuedByKey.get(key);
  if (previous) {
    previous.reject(new Error(LIBRARY_REORDER_SUPERSEDED));
  }

  const isCurrent = (): boolean => generationByKey.get(key) === generation;

  return new Promise((resolve, reject) => {
    queuedByKey.set(key, {
      generation,
      run: () => run({ generation, isCurrent }),
      resolve,
      reject,
    });
    drain(key);
  });
};

export const waitForLibraryReorderIdle = async (
  keys: LibraryReorderListKey[],
): Promise<void> => {
  await Promise.all(keys.map((key) => inFlightByKey.get(key) ?? Promise.resolve()));
};

export const waitForNonLibraryReorderIdle = async (): Promise<void> => {
  while (true) {
    const pending = [...inFlightByKey.entries()]
      .filter(([key]) => key !== 'library')
      .map(([, promise]) => promise);
    if (pending.length === 0) {
      return;
    }

    await Promise.all(pending);
  }
};

export const supersedeNonLibraryReorderQueues = (): void => {
  const keys = new Set<LibraryReorderListKey>([
    ...queuedByKey.keys(),
    ...inFlightByKey.keys(),
  ]);
  for (const key of keys) {
    if (key === 'library') {
      continue;
    }

    nextGeneration(key);
    const queued = queuedByKey.get(key);
    if (queued) {
      queuedByKey.delete(key);
      queued.reject(new Error(LIBRARY_REORDER_SUPERSEDED_BY_IMPORT));
    }
  }
};

export const withNonLibraryImportLock = async <T>(run: () => Promise<T>): Promise<T> => {
  const acquired = nonLibraryImportLockCount === 0;
  nonLibraryImportLock = true;
  nonLibraryImportLockCount += 1;
  try {
    if (acquired) {
      supersedeNonLibraryReorderQueues();
      await waitForNonLibraryReorderIdle();
    }
    return await run();
  } finally {
    nonLibraryImportLockCount -= 1;
    if (nonLibraryImportLockCount === 0) {
      nonLibraryImportLock = false;
    }
  }
};
