const noMutation = (): null => null;
const asyncNoop = async (): Promise<void> => {};

export const useFeedPatchedMutation = noMutation;
export const useStationPatchedMutation = noMutation;
export const useFeedDeletedMutation = noMutation;
export const useFeedsAddedMutation = noMutation;
export const useSmartViewsPatchedMutation = noMutation;
export const useStationsReorderedMutation = noMutation;
export const useStationDeletedMutation = noMutation;
export const useStationsHydratedMutation = noMutation;
export const useFeedsCountsUpdatedMutation = noMutation;
export const useUnstationedReorderedMutation = noMutation;
export const useStationMembershipReorderedMutation = noMutation;
export const useUnstationedHydratedMutation = noMutation;

export function useFeedRefreshActivity() {
  return {
    activeFeedCount: 0,
    queuedFeedCount: 0,
    foregroundQueuedFeedCount: 0,
    backgroundQueuedFeedCount: 0,
    displayFeedCount: 8,
    isAnyFeedRefreshing: false,
    isForegroundFeedRefreshing: false,
    isBackgroundFeedRefreshing: false,
    interactiveRefreshScopeTotal: 0,
    interactiveRefreshCompleted: 0,
    interactiveRefreshScopeKind: null,
    interactiveRefreshScopeLabel: '',
  };
}

export function useUserMessageChannel(): null {
  return null;
}

export function useUserMessage(): null {
  return null;
}

export function useAppUpdatePrompt() {
  const availability = {
    currentVersion: '1.3.0',
    latestVersion: '1.4.0',
    releaseUrl: 'https://example.com/releases/1.4.0',
  };

  return {
    availability,
    showBadge: true,
    refreshAvailability: async () => availability,
    openUpdatePrompt: asyncNoop,
  };
}

