import type { TasksContract } from "./contracts";
import { invokeContract } from "./core";

export const helper = {
  add(
    request: TasksContract["helperAdd"]["request"],
  ): Promise<TasksContract["helperAdd"]["response"]> {
    return invokeContract<TasksContract["helperAdd"]>("tasks_helper_add", request);
  },
  remove(
    request: TasksContract["helperRemove"]["request"],
  ): Promise<TasksContract["helperRemove"]["response"]> {
    return invokeContract<TasksContract["helperRemove"]>("tasks_helper_remove", request);
  },
  clear(): Promise<TasksContract["helperClear"]["response"]> {
    return invokeContract<TasksContract["helperClear"]>("tasks_helper_clear");
  },
  getQueueSnapshot(): Promise<TasksContract["helperGetQueueSnapshot"]["response"]> {
    return invokeContract<TasksContract["helperGetQueueSnapshot"]>("tasks_helper_get_queue_snapshot");
  },
};
