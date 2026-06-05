import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react';
import { isInteractionPerformanceEnabled } from '@/services/performance/interactionPerformance';

interface InteractionProfilerProps {
  id: string;
  onRender: ProfilerOnRenderCallback;
  children: ReactNode;
}

export const InteractionProfiler = ({ id, onRender, children }: InteractionProfilerProps) => {
  if (!isInteractionPerformanceEnabled) {
    return <>{children}</>;
  }

  return (
    <Profiler id={id} onRender={onRender}>
      {children}
    </Profiler>
  );
};
