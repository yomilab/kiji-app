import type { DiagnosticsContract } from "./contracts";
import { invokeContract } from "./core";

export async function logWriteEntry(
  request: DiagnosticsContract["logWriteEntry"]["request"],
): Promise<DiagnosticsContract["logWriteEntry"]["response"]> {
  return invokeContract<DiagnosticsContract["logWriteEntry"]>("diagnostics_log_write_entry", request);
}

export async function logGetPath(): Promise<DiagnosticsContract["logGetPath"]["response"]> {
  return invokeContract<DiagnosticsContract["logGetPath"]>("diagnostics_log_get_path");
}

export async function performanceSnapshot(): Promise<
  DiagnosticsContract["performanceSnapshot"]["response"]
> {
  return invokeContract<DiagnosticsContract["performanceSnapshot"]>(
    "diagnostics_performance_snapshot",
  );
}

export async function exportBundle(): Promise<DiagnosticsContract["exportBundle"]["response"]> {
  return invokeContract<DiagnosticsContract["exportBundle"]>("diagnostics_export_bundle");
}
