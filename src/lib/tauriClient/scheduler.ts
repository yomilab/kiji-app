import type { BackgroundUpdateMode } from "@/services/scheduler/types";
import { invokeCommand } from "./core";

export async function start(payload: { mode: BackgroundUpdateMode }): Promise<string> {
  return invokeCommand<string>("scheduler_start", { mode: payload.mode });
}

export async function stop(): Promise<void> {
  await invokeCommand<void>("scheduler_stop");
}

export async function reconfigure(payload: { mode: BackgroundUpdateMode }): Promise<void> {
  await invokeCommand<void>("scheduler_reconfigure", { mode: payload.mode });
}
