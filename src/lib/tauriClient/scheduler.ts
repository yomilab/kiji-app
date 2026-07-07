import type { SchedulerContract } from "./contracts";
import { invokeCommand, invokeContract } from "./core";

export async function start(
  request: SchedulerContract["start"]["request"],
): Promise<SchedulerContract["start"]["response"]> {
  return invokeContract<SchedulerContract["start"]>("scheduler_start", request);
}

export async function stop(): Promise<SchedulerContract["stop"]["response"]> {
  return invokeContract<SchedulerContract["stop"]>("scheduler_stop");
}

export async function reconfigure(
  request: SchedulerContract["reconfigure"]["request"],
): Promise<SchedulerContract["reconfigure"]["response"]> {
  return invokeContract<SchedulerContract["reconfigure"]>("scheduler_reconfigure", request);
}

export async function createRunPlan(
  request: SchedulerContract["createRunPlan"]["request"],
): Promise<SchedulerContract["createRunPlan"]["response"]> {
  return invokeContract<SchedulerContract["createRunPlan"]>("scheduler_create_run_plan", request);
}

export async function previewNativeCycle(
  request: SchedulerContract["previewNativeCycle"]["request"],
): Promise<SchedulerContract["previewNativeCycle"]["response"]> {
  return invokeCommand<SchedulerContract["previewNativeCycle"]["response"]>(
    "scheduler_preview_native_cycle",
    { request },
  );
}
