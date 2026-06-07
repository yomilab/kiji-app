import { InProcessExecutionBackend } from '@/services/tasks/backends/inProcessExecutionBackend';
import type {
  HelperTaskAddRequest,
  HelperTaskAddResponse,
  HelperTaskClearResponse,
  HelperTaskQueueSizeSnapshot,
  HelperTaskRemoveRequest,
  HelperTaskRemoveResponse,
  HelperTaskResultEvent,
} from '@/services/tasks/helperTaskContracts';
import { HelperTaskServer } from '@/services/tasks/helperTaskServer';

const RENDERER_OWNER_ID = 1;

type TaskResultCallback = (event: HelperTaskResultEvent) => void;

let server: HelperTaskServer | null = null;
const listeners = new Set<TaskResultCallback>();

function getServer(): HelperTaskServer {
  if (!server) {
    server = new HelperTaskServer({
      backend: new InProcessExecutionBackend(),
      maxConcurrent: 3,
      onTaskSettled: (_ownerId, event) => {
        for (const listener of listeners) {
          listener(event);
        }
      },
    });
  }

  return server;
}

export function installHelperTaskService(): void {
  getServer();
}

export function onHelperTaskResult(callback: TaskResultCallback): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export async function helperTaskAdd(request: HelperTaskAddRequest): Promise<HelperTaskAddResponse> {
  return getServer().addTask(RENDERER_OWNER_ID, request);
}

export async function helperTaskRemove(
  request: HelperTaskRemoveRequest,
): Promise<HelperTaskRemoveResponse> {
  return getServer().removeTask(RENDERER_OWNER_ID, request.taskId);
}

export async function helperTaskClear(): Promise<HelperTaskClearResponse> {
  return getServer().clearTasks(RENDERER_OWNER_ID);
}

export async function helperTaskGetQueueSnapshot(): Promise<HelperTaskQueueSizeSnapshot> {
  return getServer().getQueueSnapshot();
}
