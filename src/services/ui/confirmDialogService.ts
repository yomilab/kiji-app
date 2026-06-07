export interface ConfirmDialogRequest {
  title?: string;
  message: string;
}

export async function confirmDialog(request: ConfirmDialogRequest): Promise<boolean> {
  if (window.electronAPI?.confirmDialog) {
    return window.electronAPI.confirmDialog(request);
  }

  return window.confirm(request.message);
}
