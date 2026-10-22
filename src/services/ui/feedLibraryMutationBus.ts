import type { Feed } from '@/services/feeds/feedsManager';
import type { SmartViewSettings } from '@/services/settings/types';
import type { Tag } from '@/types/tag';
import type { FeedHealthFields } from '@/services/feeds/feedHealth';

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
  /** `health` is set when a refresh changed whether the feed can update (see `feedHealthSync`). */
  feeds: Array<Pick<Feed, 'id' | 'unreadCount' | 'articleCount'> & { health?: FeedHealthFields }>;
}

export interface FeedCountsEntry {
  feedId: string;
  unreadCount: number;
  articleCount: number;
  health?: FeedHealthFields;
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

/**
 * One bus publish, as a plain value. The window bridge relays these between the main
 * window and Manage Feeds (separate webviews, separate bus instances).
 */
export type FeedLibraryMutationMessage =
  | { kind: 'feedPatched'; feedId: string; changes: FeedLibraryFeedPatchChanges }
  | { kind: 'stationPatched'; previousName: string; station: FeedLibraryStationPatched['station'] }
  | { kind: 'feedDeleted'; feedId: string }
  | { kind: 'feedsAdded'; feeds: Feed[] }
  | { kind: 'smartViewsPatched'; smartViews: SmartViewSettings[] }
  | { kind: 'stationsReordered'; stations: FeedLibraryStationsReordered['stations'] }
  | { kind: 'stationDeleted'; stationName: string; affectedFeedIds: string[] }
  | { kind: 'feedsCountsUpdated'; feeds: FeedCountsEntry[] }
  | { kind: 'stationsHydrated'; stations: Tag[] }
  | { kind: 'unstationedReordered'; feeds: FeedLibraryUnstationedReordered['feeds'] }
  | { kind: 'stationMembershipReordered'; stationName: string; feedIds: string[] }
  | { kind: 'unstationedHydrated'; feeds: Feed[] }
  | { kind: 'libraryHydrated'; stations: Tag[]; unstationed: Feed[] };

type OutboundRelay = (message: FeedLibraryMutationMessage) => void;
type MessageListener = (message: FeedLibraryMutationMessage, origin: 'local' | 'remote') => void;

class FeedLibraryMutationBus {
  private readonly listeners = new Set<Listener>();

  private readonly messageListeners = new Set<MessageListener>();

  private outboundRelay: OutboundRelay | null = null;

  private applyingRemote = false;

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

  /**
   * Every publish, in order, as a message. Snapshot subscribers (`subscribe` + getters) only
   * see the latest value per kind, so a burst of same-kind publishes (bulk delete) collapses;
   * list owners that must apply each one use this instead.
   */
  subscribeMessages = (listener: MessageListener): (() => void) => {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  };

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
    this.dispatch({ kind: 'feedPatched', feedId, changes });
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
    this.dispatch({ kind: 'stationPatched', previousName, station });
  }

  publishFeedDeleted(feedId: string): void {
    this.revision += 1;
    this.feedDeleted = {
      revision: this.revision,
      feedId,
    };
    this.emit();
    this.dispatch({ kind: 'feedDeleted', feedId });
  }

  publishFeedsAdded(feeds: Feed[]): void {
    if (feeds.length === 0) return;

    this.revision += 1;
    this.feedsAdded = {
      revision: this.revision,
      feeds,
    };
    this.emit();
    this.dispatch({ kind: 'feedsAdded', feeds });
  }

  publishSmartViewsPatched(smartViews: SmartViewSettings[]): void {
    this.revision += 1;
    this.smartViewsPatched = {
      revision: this.revision,
      smartViews,
    };
    this.emit();
    this.dispatch({ kind: 'smartViewsPatched', smartViews });
  }

  publishStationsReordered(stations: FeedLibraryStationsReordered['stations']): void {
    this.revision += 1;
    this.stationsReordered = {
      revision: this.revision,
      stations,
    };
    this.emit();
    this.dispatch({ kind: 'stationsReordered', stations });
  }

  publishStationDeleted(stationName: string, affectedFeedIds: string[] = []): void {
    this.revision += 1;
    this.stationDeleted = {
      revision: this.revision,
      stationName,
      affectedFeedIds,
    };
    this.emit();
    this.dispatch({ kind: 'stationDeleted', stationName, affectedFeedIds });
  }

  publishFeedsCountsUpdated(feeds: FeedCountsEntry[]): void {
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
        ...(feed.health ? { health: feed.health } : {}),
      })),
    };
    this.emit();
    this.dispatch({ kind: 'feedsCountsUpdated', feeds });
  }

  publishStationsHydrated(stations: Tag[]): void {
    this.revision += 1;
    this.stationsHydrated = {
      revision: this.revision,
      stations,
    };
    this.emit();
    this.dispatch({ kind: 'stationsHydrated', stations });
  }

  publishUnstationedReordered(feeds: FeedLibraryUnstationedReordered['feeds']): void {
    this.revision += 1;
    this.unstationedReordered = {
      revision: this.revision,
      feeds,
    };
    this.emit();
    this.dispatch({ kind: 'unstationedReordered', feeds });
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
    this.dispatch({ kind: 'stationMembershipReordered', ...payload });
  }

  publishUnstationedHydrated(feeds: Feed[]): void {
    this.revision += 1;
    this.unstationedHydrated = {
      revision: this.revision,
      feeds,
    };
    this.emit();
    this.dispatch({ kind: 'unstationedHydrated', feeds });
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
    this.dispatch({ kind: 'libraryHydrated', stations: payload.stations, unstationed: payload.unstationed });
  }

  /** Send every local publish to `relay` (the window bridge); null stops relaying. */
  setOutboundRelay(relay: OutboundRelay | null): void {
    this.outboundRelay = relay;
  }

  getOutboundRelay(): OutboundRelay | null {
    return this.outboundRelay;
  }

  /** Publish a mutation that another window already persisted, without relaying it back. */
  applyRemote(message: FeedLibraryMutationMessage): void {
    this.applyingRemote = true;
    try {
      switch (message.kind) {
        case 'feedPatched':
          this.publishFeedPatched(message.feedId, message.changes);
          return;
        case 'stationPatched':
          this.publishStationPatched(message.previousName, message.station);
          return;
        case 'feedDeleted':
          this.publishFeedDeleted(message.feedId);
          return;
        case 'feedsAdded':
          this.publishFeedsAdded(message.feeds);
          return;
        case 'smartViewsPatched':
          this.publishSmartViewsPatched(message.smartViews);
          return;
        case 'stationsReordered':
          this.publishStationsReordered(message.stations);
          return;
        case 'stationDeleted':
          this.publishStationDeleted(message.stationName, message.affectedFeedIds);
          return;
        case 'feedsCountsUpdated':
          this.publishFeedsCountsUpdated(message.feeds);
          return;
        case 'stationsHydrated':
          this.publishStationsHydrated(message.stations);
          return;
        case 'unstationedReordered':
          this.publishUnstationedReordered(message.feeds);
          return;
        case 'stationMembershipReordered':
          this.publishStationMembershipReordered({
            stationName: message.stationName,
            feedIds: message.feedIds,
          });
          return;
        case 'unstationedHydrated':
          this.publishUnstationedHydrated(message.feeds);
          return;
        case 'libraryHydrated':
          this.publishLibraryHydrated({ stations: message.stations, unstationed: message.unstationed });
          return;
        default:
          return;
      }
    } finally {
      this.applyingRemote = false;
    }
  }

  private dispatch(message: FeedLibraryMutationMessage): void {
    const origin = this.applyingRemote ? 'remote' : 'local';
    for (const listener of this.messageListeners) {
      listener(message, origin);
    }
    if (origin === 'remote' || !this.outboundRelay) {
      return;
    }
    this.outboundRelay(message);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const feedLibraryMutationBus = new FeedLibraryMutationBus();
