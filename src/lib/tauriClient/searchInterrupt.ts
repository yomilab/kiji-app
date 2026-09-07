import { invoke } from "@tauri-apps/api/core";

/** Cancels in-flight search MATCH on registered reader generations only. */
export async function interruptArticleListSearchMatch(): Promise<void> {
  try {
    await invoke("articles_interrupt_search");
  } catch {
    // No registered MATCH, or renderer tests without Tauri.
  }
}
