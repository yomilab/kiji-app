export type TaskPoolTask = () => Promise<void>;

export interface TaskPool {
  enqueue: (task: TaskPoolTask) => void;
  whenIdle: () => Promise<void>;
}

interface TaskPoolOptions {
  concurrency: number;
}

export const createTaskPool = (options: TaskPoolOptions): TaskPool => {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const queue: TaskPoolTask[] = [];
  let runningCount = 0;
  const idleResolvers: Array<() => void> = [];

  const resolveIdleIfNeeded = () => {
    if (runningCount !== 0 || queue.length !== 0) {
      return;
    }
    while (idleResolvers.length > 0) {
      const resolve = idleResolvers.shift();
      resolve?.();
    }
  };

  const runTask = async (task: TaskPoolTask) => {
    try {
      await task();
    } catch {
      // Background tasks are best-effort; swallow to keep the queue draining.
    } finally {
      runningCount = Math.max(0, runningCount - 1);
      schedule();
    }
  };

  const schedule = () => {
    while (runningCount < concurrency && queue.length > 0) {
      const nextTask = queue.shift();
      if (!nextTask) {
        break;
      }
      runningCount += 1;
      void runTask(nextTask);
    }

    resolveIdleIfNeeded();
  };

  const enqueue = (task: TaskPoolTask) => {
    queue.push(task);
    schedule();
  };

  const whenIdle = async () => {
    if (runningCount === 0 && queue.length === 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      idleResolvers.push(resolve);
    });
  };

  return {
    enqueue,
    whenIdle,
  };
};
