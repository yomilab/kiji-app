import { getAllFeedMetadataCached } from '@/services/feeds/feedMetadataCache';
import { settingsManager } from '@/services/settings';
import { storage } from '@/services/storage/storageFactory';
import { tagsManager } from '@/services/tags/tagsManager';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import type { CommandPaletteCatalog } from './commandPaletteModel';

/**
 * One library snapshot for the palette, reused across opens until any library
 * mutation lands (same invalidation as the sidebar feed metadata cache). Feeds
 * come from that shared slim catalog; typing never touches the database.
 */
let cachedCatalog: CommandPaletteCatalog | null = null;
let revision = 0;
let unsubscribe: (() => void) | null = null;

const ensureInvalidation = (): void => {
  if (unsubscribe) return;
  unsubscribe = feedLibraryMutationBus.subscribe(() => {
    cachedCatalog = null;
    revision += 1;
  });
};

const parseEmojis = (raw: string | null): Record<string, string> => {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
};

/** Last loaded catalog, for an instant first paint on open. */
export const peekCommandPaletteCatalog = (): CommandPaletteCatalog | null => cachedCatalog;

export async function loadCommandPaletteCatalog(): Promise<CommandPaletteCatalog> {
  ensureInvalidation();
  if (cachedCatalog) return cachedCatalog;

  const startRevision = revision;
  const [feeds, stations, smartViews, emojis] = await Promise.all([
    getAllFeedMetadataCached(),
    tagsManager.getAllTags(),
    settingsManager.getSmartViews(),
    storage.get('smart-views-emojis'),
  ]);
  const catalog: CommandPaletteCatalog = {
    feeds,
    stations,
    smartViews,
    smartViewEmojis: parseEmojis(emojis),
  };
  if (startRevision === revision) {
    cachedCatalog = catalog;
  }
  return catalog;
}

/** Test-only. */
export function resetCommandPaletteCatalogForTests(): void {
  cachedCatalog = null;
  unsubscribe?.();
  unsubscribe = null;
}
