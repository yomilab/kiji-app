export interface ConfirmDialogRequest {
  title?: string;
  message: string;
}

import { getE2eConfig } from '@/services/e2e/e2eHarness';

export async function confirmDialog(request: ConfirmDialogRequest): Promise<boolean> {
  if (getE2eConfig()?.autoConfirm) {
    return true;
  }

  if (window.kijiAPI?.confirmDialog) {
    return window.kijiAPI.confirmDialog(request);
  }

  return window.confirm(request.message);
}
