import type {
  HelperTaskAddRequest,
  HelperTaskAddResponse,
  HelperTaskClearResponse,
  HelperTaskKind,
  HelperTaskQueueSizeSnapshot,
  HelperTaskResultMap,
  HelperTaskRemoveResponse,
  HelperTaskResultEvent,
} from '@/services/tasks/helperTaskContracts';
import {
  helperTaskAdd,
  helperTaskClear,
  helperTaskGetQueueSnapshot,
  helperTaskRemove,
  onHelperTaskResult,
} from '@/services/tasks/helperTaskService';

type TaskResultCallback = (event: HelperTaskResultEvent) => void;

class HelperTaskClient {
  private listeners = new Set<TaskResultCallback>();
  private isListenerRegistered = false;

  private ensureListener() {
    if (this.isListenerRegistered) return;

    onHelperTaskResult((event) => {
      for (const listener of this.listeners) {
        listener(event);
      }
    });

    this.isListenerRegistered = true;
  }

  async addTask<K extends HelperTaskKind>(
    request: HelperTaskAddRequest<K>,
  ): Promise<HelperTaskAddResponse> {
    return helperTaskAdd(request);
  }

  async runTask<K extends HelperTaskKind>(
    request: HelperTaskAddRequest<K>,
  ): Promise<HelperTaskResultMap[K]> {
    this.ensureListener();
    const added = await this.addTask(request);

    return new Promise<HelperTaskResultMap[K]>((resolve, reject) => {
      const callback: TaskResultCallback = (event) => {
        if (event.taskId !== added.taskId) return;

        this.listeners.delete(callback);

        if (event.status === 'completed') {
          resolve(event.result as HelperTaskResultMap[K]);
          return;
        }

        if (event.status === 'failed') {
          reject(new Error(event.error));
          return;
        }

        reject(new Error('Task cancelled'));
      };

      this.listeners.add(callback);
    });
  }

  async removeTask(taskId: string): Promise<HelperTaskRemoveResponse> {
    return helperTaskRemove({ taskId });
  }

  async clearTasks(): Promise<HelperTaskClearResponse> {
    return helperTaskClear();
  }

  async getQueueSnapshot(): Promise<HelperTaskQueueSizeSnapshot> {
    return helperTaskGetQueueSnapshot();
  }

  onTaskResult(callback: TaskResultCallback): () => void {
    this.ensureListener();
    this.listeners.add(callback);

    return () => {
      this.listeners.delete(callback);
    };
  }
}

export const helperTaskClient = new HelperTaskClient();
