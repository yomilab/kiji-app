import { DEFAULT_SMART_VIEW_DEFINITIONS } from '@/constants';
import type { SmartViewSettings } from './types';

/**
 * Merges saved Library order/visibility with the current smart view definitions.
 * Saved rows keep their relative order and hidden state; a view the saved prefs
 * don't know yet (e.g. Today) is inserted visible right after its default
 * predecessor, so upgrading never resets the user's order.
 */
export const mergeSmartViewSettings = (
  smartViews: SmartViewSettings[] | undefined,
): SmartViewSettings[] => {
  const knownIds = new Set(DEFAULT_SMART_VIEW_DEFINITIONS.map((definition) => definition.id));
  const seen = new Set<string>();
  const ordered = (smartViews ?? [])
    .filter((view) => {
      if (!knownIds.has(view.id) || seen.has(view.id)) return false;
      seen.add(view.id);
      return true;
    })
    .map((view, index) => ({ view, index }))
    .sort((left, right) => (left.view.sortOrder - right.view.sortOrder) || (left.index - right.index))
    .map(({ view }) => ({ id: view.id, visible: view.visible ?? true, sortOrder: view.sortOrder }));

  const missing = DEFAULT_SMART_VIEW_DEFINITIONS.filter((definition) => !seen.has(definition.id));
  if (missing.length === 0) return ordered;

  for (const definition of missing) {
    const defaultIndex = DEFAULT_SMART_VIEW_DEFINITIONS.indexOf(definition);
    let insertAt = 0;
    for (let index = defaultIndex - 1; index >= 0; index -= 1) {
      const predecessorAt = ordered.findIndex((view) => view.id === DEFAULT_SMART_VIEW_DEFINITIONS[index].id);
      if (predecessorAt >= 0) {
        insertAt = predecessorAt + 1;
        break;
      }
    }
    ordered.splice(insertAt, 0, { id: definition.id, visible: true, sortOrder: 0 });
  }

  return ordered.map((view, index) => ({ ...view, sortOrder: index }));
};
