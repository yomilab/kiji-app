import type { HelperTaskExecutionInput } from '@/services/tasks/helperTaskContracts';
import { runHelperTask } from '@/services/tasks/taskOperations';
import type { TaskExecutionBackend } from './taskExecutionBackend';

export class InProcessExecutionBackend implements TaskExecutionBackend {
  async execute(input: HelperTaskExecutionInput, signal: AbortSignal) {
    if (signal.aborted) {
      const aborted = new Error('Task aborted');
      aborted.name = 'AbortError';
      throw aborted;
    }

    return runHelperTask(input, signal);
  }

  async cancel(taskId: string): Promise<void> {
    void taskId;
  }

  async dispose(): Promise<void> {}
}
