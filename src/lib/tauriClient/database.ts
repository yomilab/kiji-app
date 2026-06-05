import type { DatabaseContract } from "./contracts";
import { invokeContract } from "./core";

export async function getStatus(): Promise<DatabaseContract["getStatus"]["response"]> {
  return invokeContract<DatabaseContract["getStatus"]>("db_get_status");
}
