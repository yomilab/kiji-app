import type { HelperTaskAnyResult, HelperTaskExecutionInput } from '@/services/tasks/helperTaskContracts';

export interface TaskExecutionBackend {
  execute(input: HelperTaskExecutionInput, signal: AbortSignal): Promise<HelperTaskAnyResult>;
  cancel(taskId: string): Promise<void>;
  dispose(): Promise<void>;
}
