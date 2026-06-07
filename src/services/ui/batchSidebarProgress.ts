import { sidebarIndicatorService } from '@/services/ui/sidebarIndicatorService';
import {
  sidebarIndicatorOngoing,
  type SidebarIndicatorAction,
  type SidebarIndicatorTextOptions,
} from '@/services/ui/sidebarIndicatorText';

const shouldReportProgress = (completed: number, total: number): boolean => (
  total <= 1
  || completed === 0
  || completed === total
  || completed % Math.max(1, Math.floor(total / 20)) === 0
);

export async function runWithSidebarBatchProgress<T>(
  action: SidebarIndicatorAction,
  total: number,
  work: (reportProgress: (completed: number) => void) => Promise<T>,
  options?: SidebarIndicatorTextOptions,
): Promise<T> {
  const reportProgress = (completed: number) => {
    if (!shouldReportProgress(completed, total)) {
      return;
    }

    sidebarIndicatorService.show(
      total <= 1
        ? sidebarIndicatorOngoing(action, undefined, options)
        : sidebarIndicatorOngoing(action, { completed, total }, options),
    );
  };

  reportProgress(0);
  return work(reportProgress);
}
