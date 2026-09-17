let restoreGeneration = 0;

export function beginSidebarRestoreAttempt(): number {
  restoreGeneration += 1;
  return restoreGeneration;
}

export function isCurrentSidebarRestoreAttempt(attempt: number): boolean {
  return attempt === restoreGeneration;
}

export function abortPendingSidebarRestore(): void {
  restoreGeneration += 1;
}

export function resetSidebarRestoreGenerationForTests(): void {
  restoreGeneration = 0;
}
