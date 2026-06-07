import { sidebarIndicatorService } from '@/services/ui/sidebarIndicatorService';

const shouldReportProgress = (completed: number, total: number): boolean => (
  total <= 1
  || completed === 0
  || completed === total
  || completed % Math.max(1, Math.floor(total / 20)) === 0
);

export async function runWithSidebarBatchProgress<T>(
  label: string,
  total: number,
  work: (reportProgress: (completed: number) => void) => Promise<T>,
): Promise<T> {
  const reportProgress = (completed: number) => {
    if (!shouldReportProgress(completed, total)) {
      return;
    }

    sidebarIndicatorService.show(
      total <= 1 ? `${label}…` : `${label}… ${completed}/${total}`,
    );
  };

  reportProgress(0);
  return work(reportProgress);
}
