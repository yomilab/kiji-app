import { describe, expect, it } from 'vitest';
import { createTaskPool } from '@/services/tasks/taskPool';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

const createDeferred = (): Deferred => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('taskPool', () => {
  it('runs tasks with bounded concurrency', async () => {
    const pool = createTaskPool({ concurrency: 2 });
    const deferredTasks = [createDeferred(), createDeferred(), createDeferred(), createDeferred()];
    let active = 0;
    let peakActive = 0;

    for (const deferred of deferredTasks) {
      pool.enqueue(async () => {
        active += 1;
        peakActive = Math.max(peakActive, active);
        await deferred.promise;
        active -= 1;
      });
    }

    await Promise.resolve();
    expect(peakActive).toBe(2);

    deferredTasks[0].resolve();
    deferredTasks[1].resolve();
    await Promise.resolve();

    deferredTasks[2].resolve();
    deferredTasks[3].resolve();
    await pool.whenIdle();
    expect(peakActive).toBe(2);
  });

  it('continues draining when a task throws', async () => {
    const pool = createTaskPool({ concurrency: 1 });
    const completed: number[] = [];

    pool.enqueue(async () => {
      throw new Error('boom');
    });
    pool.enqueue(async () => {
      completed.push(1);
    });

    await pool.whenIdle();
    expect(completed).toEqual([1]);
  });
});
