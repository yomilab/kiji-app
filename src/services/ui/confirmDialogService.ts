export interface ConfirmDialogRequest {
  title?: string;
  message: string;
}

import { getE2eConfig } from '@/services/e2e/e2eHarness';

export async function confirmDialog(request: ConfirmDialogRequest): Promise<boolean> {
  if (getE2eConfig()?.autoConfirm) {
    return true;
  }

  if (window.electronAPI?.confirmDialog) {
    return window.electronAPI.confirmDialog(request);
  }

  return window.confirm(request.message);
}
