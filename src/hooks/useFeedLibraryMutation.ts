import { useSyncExternalStore } from 'react';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';

export const useFeedPatchedMutation = () =>
  useSyncExternalStore(
    feedLibraryMutationBus.subscribe,
    feedLibraryMutationBus.getFeedPatched,
    (): null => null
  );

export const useStationPatchedMutation = () =>
  useSyncExternalStore(
    feedLibraryMutationBus.subscribe,
    feedLibraryMutationBus.getStationPatched,
    (): null => null
  );

export const useFeedDeletedMutation = () =>
  useSyncExternalStore(
    feedLibraryMutationBus.subscribe,
    feedLibraryMutationBus.getFeedDeleted,
    (): null => null
  );

export const useFeedsAddedMutation = () =>
  useSyncExternalStore(
    feedLibraryMutationBus.subscribe,
    feedLibraryMutationBus.getFeedsAdded,
    (): null => null
  );

export const useSmartViewsPatchedMutation = () =>
  useSyncExternalStore(
    feedLibraryMutationBus.subscribe,
    feedLibraryMutationBus.getSmartViewsPatched,
    (): null => null
  );

export const useStationsReorderedMutation = () =>
  useSyncExternalStore(
    feedLibraryMutationBus.subscribe,
    feedLibraryMutationBus.getStationsReordered,
    (): null => null
  );

export const useStationDeletedMutation = () =>
  useSyncExternalStore(
    feedLibraryMutationBus.subscribe,
    feedLibraryMutationBus.getStationDeleted,
    (): null => null
  );

export const useStationsHydratedMutation = () =>
  useSyncExternalStore(
    feedLibraryMutationBus.subscribe,
    feedLibraryMutationBus.getStationsHydrated,
    (): null => null
  );

export const useFeedsCountsUpdatedMutation = () =>
  useSyncExternalStore(
    feedLibraryMutationBus.subscribe,
    feedLibraryMutationBus.getFeedsCountsUpdated,
    (): null => null,
  );
