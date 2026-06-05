import type { Feed } from '@/services/feeds/feedsManager';
import type { SmartViewSettings } from '@/services/settings/types';
import type { Tag } from '@/types/tag';

type Listener = () => void;

export type FeedLibraryFeedPatchChanges = Partial<
  Pick<Feed, 'title' | 'url' | 'tags' | 'emoji' | 'favicon' | 'faviconHasTransparency' | 'faviconBgLight' | 'faviconBgDark'>
>;

export interface FeedLibraryFeedPatched {
  revision: number;
  feedId: string;
  changes: FeedLibraryFeedPatchChanges;
}

export interface FeedLibraryFeedDeleted {
  revision: number;
  feedId: string;
}

export interface FeedLibraryFeedsAdded {
  revision: number;
  feeds: Feed[];
}

export interface FeedLibraryStationPatched {
  revision: number;
  previousName: string;
  station: Pick<Tag, 'name' | 'emoji' | 'feedIds' | 'createdAt' | 'sortOrder'>;
}

export interface FeedLibrarySmartViewsPatched {
  revision: number;
  smartViews: SmartViewSettings[];
}

export interface FeedLibraryStationsReordered {
  revision: number;
  stations: Array<Pick<Tag, 'name' | 'sortOrder'>>;
}

export interface FeedLibraryStationDeleted {
  revision: number;
  stationName: string;
  affectedFeedIds: string[];
}

export interface FeedLibraryStationsHydrated {
  revision: number;
  stations: Tag[];
}

class FeedLibraryMutationBus {
  private readonly listeners = new Set<Listener>();

  private revision = 0;

  private feedPatched: FeedLibraryFeedPatched | null = null;

  private stationPatched: FeedLibraryStationPatched | null = null;

  private feedDeleted: FeedLibraryFeedDeleted | null = null;

  private feedsAdded: FeedLibraryFeedsAdded | null = null;

  private smartViewsPatched: FeedLibrarySmartViewsPatched | null = null;

  private stationsReordered: FeedLibraryStationsReordered | null = null;

  private stationDeleted: FeedLibraryStationDeleted | null = null;

  private stationsHydrated: FeedLibraryStationsHydrated | null = null;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getFeedPatched = (): FeedLibraryFeedPatched | null => this.feedPatched;

  getStationPatched = (): FeedLibraryStationPatched | null => this.stationPatched;

  getFeedDeleted = (): FeedLibraryFeedDeleted | null => this.feedDeleted;

  getFeedsAdded = (): FeedLibraryFeedsAdded | null => this.feedsAdded;

  getSmartViewsPatched = (): FeedLibrarySmartViewsPatched | null => this.smartViewsPatched;

  getStationsReordered = (): FeedLibraryStationsReordered | null => this.stationsReordered;

  getStationDeleted = (): FeedLibraryStationDeleted | null => this.stationDeleted;

  getStationsHydrated = (): FeedLibraryStationsHydrated | null => this.stationsHydrated;

  publishFeedPatched(feedId: string, changes: FeedLibraryFeedPatchChanges): void {
    this.revision += 1;
    this.feedPatched = {
      revision: this.revision,
      feedId,
      changes,
    };
    this.emit();
  }

  publishStationPatched(
    previousName: string,
    station: FeedLibraryStationPatched['station']
  ): void {
    this.revision += 1;
    this.stationPatched = {
      revision: this.revision,
      previousName,
      station,
    };
    this.emit();
  }

  publishFeedDeleted(feedId: string): void {
    this.revision += 1;
    this.feedDeleted = {
      revision: this.revision,
      feedId,
    };
    this.emit();
  }

  publishFeedsAdded(feeds: Feed[]): void {
    if (feeds.length === 0) return;

    this.revision += 1;
    this.feedsAdded = {
      revision: this.revision,
      feeds,
    };
    this.emit();
  }

  publishSmartViewsPatched(smartViews: SmartViewSettings[]): void {
    this.revision += 1;
    this.smartViewsPatched = {
      revision: this.revision,
      smartViews,
    };
    this.emit();
  }

  publishStationsReordered(stations: FeedLibraryStationsReordered['stations']): void {
    this.revision += 1;
    this.stationsReordered = {
      revision: this.revision,
      stations,
    };
    this.emit();
  }

  publishStationDeleted(stationName: string, affectedFeedIds: string[] = []): void {
    this.revision += 1;
    this.stationDeleted = {
      revision: this.revision,
      stationName,
      affectedFeedIds,
    };
    this.emit();
  }

  publishStationsHydrated(stations: Tag[]): void {
    this.revision += 1;
    this.stationsHydrated = {
      revision: this.revision,
      stations,
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const feedLibraryMutationBus = new FeedLibraryMutationBus();
