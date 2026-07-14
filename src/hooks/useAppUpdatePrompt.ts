import { useCallback, useEffect, useState } from 'react';
import {
  checkForUpdateDetailed,
  openUpdateWindow,
  toUpdateWindowPayload,
} from '@/services/system/appUpdateService';
import {
  dismissUpdatePromptForSession,
  isUpdatePromptDismissedForSession,
  subscribeUpdatePromptSession,
} from '@/services/system/appUpdateSession';
import type { UpdateAvailability } from '@/services/system/appUpdateTypes';

function syncUpdateMenuLabel(updateAvailable: boolean): void {
  if (!window.kijiAPI?.updateAppMenuState) {
    return;
  }
  void window.kijiAPI.updateAppMenuState({ updateAvailable });
}

export function useAppUpdatePrompt() {
  const [availability, setAvailability] = useState<UpdateAvailability | null>(null);
  const [sessionDismissed, setSessionDismissed] = useState(isUpdatePromptDismissedForSession);

  const refreshAvailability = useCallback(async () => {
    const result = await checkForUpdateDetailed();
    if (result.status === 'available') {
      setAvailability(result.availability);
      syncUpdateMenuLabel(true);
      return result.availability;
    }
    setAvailability(null);
    syncUpdateMenuLabel(false);
    return null;
  }, []);

  useEffect(() => {
    void refreshAvailability();
  }, [refreshAvailability]);

  useEffect(() => subscribeUpdatePromptSession(() => {
    setSessionDismissed(isUpdatePromptDismissedForSession());
  }), []);

  const showBadge = Boolean(availability) && !sessionDismissed;

  const openUpdatePrompt = useCallback(async (availabilityOverride?: UpdateAvailability | null) => {
    const nextAvailability = availabilityOverride ?? availability ?? await refreshAvailability();
    if (!nextAvailability) {
      return false;
    }

    dismissUpdatePromptForSession();
    await openUpdateWindow(toUpdateWindowPayload(nextAvailability));
    return true;
  }, [availability, refreshAvailability]);

  return {
    availability,
    showBadge,
    refreshAvailability,
    openUpdatePrompt,
  };
}
