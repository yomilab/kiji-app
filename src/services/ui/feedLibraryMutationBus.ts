import type { Feed } from '@/services/feeds/feedsManager';
import type { SmartViewSettings } from '@/services/settings/types';
import type { Tag } from '@/types/tag';

type Listener = () => void;

export type FeedLibraryFeedPatchChanges = Partial<
  Pick<Feed, 'title' | 'url' | 'tags' | 'emoji' | 'favicon' | 'faviconHasTransparency' | 'faviconBgLight' | 'faviconBgDark' | 'unreadCount' | 'articleCount'>
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
  station: Pick<Tag, 'name' | 'emoji' | 'createdAt' | 'sortOrder'> & Partial<Pick<Tag, 'feedIds'>>;
}

export interface FeedLibrarySmartViewsPatched {
  revision: number;
  smartViews: SmartViewSettings[];
}

export interface FeedLibraryStationsReordered {
  revision: number;
  stations: Array<Pick<Tag, 'name' | 'sortOrder'>>;
}

export interface FeedLibraryFeedsCountsUpdated {
  revision: number;
  feeds: Array<Pick<Feed, 'id' | 'unreadCount' | 'articleCount'>>;
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

export interface FeedLibraryUnstationedReordered {
  revision: number;
  feeds: Array<Pick<Feed, 'id' | 'sortOrder'>>;
}

export interface FeedLibraryStationMembershipReordered {
  revision: number;
  stationName: string;
  feedIds: string[];
}

export interface FeedLibraryUnstationedHydrated {
  revision: number;
  feeds: Feed[];
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

  private feedsCountsUpdated: FeedLibraryFeedsCountsUpdated | null = null;

  private unstationedReordered: FeedLibraryUnstationedReordered | null = null;

  private stationMembershipReordered: FeedLibraryStationMembershipReordered | null = null;

  private unstationedHydrated: FeedLibraryUnstationedHydrated | null = null;

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

  getFeedsCountsUpdated = (): FeedLibraryFeedsCountsUpdated | null => this.feedsCountsUpdated;

  getUnstationedReordered = (): FeedLibraryUnstationedReordered | null => this.unstationedReordered;

  getStationMembershipReordered = (): FeedLibraryStationMembershipReordered | null =>
    this.stationMembershipReordered;

  getUnstationedHydrated = (): FeedLibraryUnstationedHydrated | null => this.unstationedHydrated;

  isStationsHydrateFresh = (
    hydrate: FeedLibraryStationsHydrated | null = this.stationsHydrated,
  ): boolean => {
    if (!hydrate) {
      return false;
    }

    const later = [
      this.stationsReordered?.revision,
      this.stationMembershipReordered?.revision,
      this.stationDeleted?.revision,
      this.stationPatched?.revision,
      this.feedDeleted?.revision,
      this.feedsAdded?.revision,
    ].filter((revision): revision is number => typeof revision === 'number');
    return later.every((revision) => revision <= hydrate.revision);
  };

  isUnstationedHydrateFresh = (
    hydrate: FeedLibraryUnstationedHydrated | null = this.unstationedHydrated,
  ): boolean => {
    if (!hydrate) {
      return false;
    }

    const later = [
      this.unstationedReordered?.revision,
      this.stationMembershipReordered?.revision,
      this.stationPatched?.revision,
      this.stationDeleted?.revision,
      this.feedDeleted?.revision,
      this.feedsAdded?.revision,
    ].filter((revision): revision is number => typeof revision === 'number');
    return later.every((revision) => revision <= hydrate.revision);
  };

  isStationMembershipLeftoverFresh = (
    membership: FeedLibraryStationMembershipReordered | null = this.stationMembershipReordered,
  ): boolean => {
    if (!membership) {
      return false;
    }

    const later = [
      this.stationsHydrated?.revision,
      this.stationPatched?.revision,
      this.stationDeleted?.revision,
      this.feedDeleted?.revision,
    ].filter((revision): revision is number => typeof revision === 'number');
    return later.every((revision) => revision <= membership.revision);
  };

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

  publishFeedsCountsUpdated(
    feeds: Array<{ feedId: string; unreadCount: number; articleCount: number }>,
  ): void {
    if (feeds.length === 0) {
      return;
    }

    this.revision += 1;
    this.feedsCountsUpdated = {
      revision: this.revision,
      feeds: feeds.map((feed) => ({
        id: feed.feedId,
        unreadCount: feed.unreadCount,
        articleCount: feed.articleCount,
      })),
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

  publishUnstationedReordered(feeds: FeedLibraryUnstationedReordered['feeds']): void {
    this.revision += 1;
    this.unstationedReordered = {
      revision: this.revision,
      feeds,
    };
    this.emit();
  }

  publishStationMembershipReordered(
    payload: Omit<FeedLibraryStationMembershipReordered, 'revision'>,
  ): void {
    this.revision += 1;
    this.stationMembershipReordered = {
      revision: this.revision,
      ...payload,
    };
    this.emit();
  }

  publishUnstationedHydrated(feeds: Feed[]): void {
    this.revision += 1;
    this.unstationedHydrated = {
      revision: this.revision,
      feeds,
    };
    this.emit();
  }

  resetForTests(): void {
    this.revision = 0;
    this.feedPatched = null;
    this.stationPatched = null;
    this.feedDeleted = null;
    this.feedsAdded = null;
    this.smartViewsPatched = null;
    this.stationsReordered = null;
    this.stationDeleted = null;
    this.stationsHydrated = null;
    this.feedsCountsUpdated = null;
    this.unstationedReordered = null;
    this.stationMembershipReordered = null;
    this.unstationedHydrated = null;
    this.emit();
  }

  publishLibraryHydrated(payload: { stations: Tag[]; unstationed: Feed[] }): void {
    this.revision += 1;
    this.stationsHydrated = {
      revision: this.revision,
      stations: payload.stations,
    };
    this.unstationedHydrated = {
      revision: this.revision,
      feeds: payload.unstationed,
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
