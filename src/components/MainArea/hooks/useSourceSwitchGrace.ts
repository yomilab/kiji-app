import { useRef } from 'react';
import { useDependencyEffect } from '@/hooks/useLifecycleEffects';

interface UseSourceSwitchGraceOptions {
  sourceKey: string;
  enabled: boolean;
  applySourceSwitchGrace: () => void;
}

export const useSourceSwitchGrace = ({
  sourceKey,
  enabled,
  applySourceSwitchGrace,
}: UseSourceSwitchGraceOptions): void => {
  const previousSourceKeyRef = useRef(sourceKey);

  useDependencyEffect(() => {
    const previousSourceKey = previousSourceKeyRef.current;
    if (sourceKey === previousSourceKey) return;

    if (enabled) {
      applySourceSwitchGrace();
    }

    previousSourceKeyRef.current = sourceKey;
  }, [sourceKey, enabled, applySourceSwitchGrace]);
};
