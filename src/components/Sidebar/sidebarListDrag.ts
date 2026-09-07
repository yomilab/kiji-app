export type SidebarDragGroup = 'library' | 'station' | 'nested' | 'unstationed';

export type SidebarDragPayload = {
  group: SidebarDragGroup;
  listKey: string;
  id: string;
};

const CLICK_SUPPRESS_MS = 400;

let clickSuppressUntil = 0;
let clickSuppressAttached = false;
const abortHandlers = new Set<() => void>();

const suppressClick = (event: MouseEvent) => {
  if (Date.now() > clickSuppressUntil) {
    document.removeEventListener('click', suppressClick, true);
    clickSuppressAttached = false;
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  document.removeEventListener('click', suppressClick, true);
  clickSuppressAttached = false;
};

export const isSidebarRowDragIgnored = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest('button, a, input, textarea, .button-stack, [data-component="button-stack"]'),
  );
};

export const armSidebarClickSuppress = (): void => {
  clickSuppressUntil = Date.now() + CLICK_SUPPRESS_MS;
  if (!clickSuppressAttached) {
    document.addEventListener('click', suppressClick, true);
    clickSuppressAttached = true;
  }
};

export const registerSidebarDragAbort = (abort: () => void): void => {
  abortHandlers.add(abort);
};

export const unregisterSidebarDragAbort = (abort: () => void): void => {
  abortHandlers.delete(abort);
};

export const abortSidebarListDrag = (): void => {
  for (const abort of abortHandlers) {
    abort();
  }
};

const isSidebarDragGroup = (value: unknown): value is SidebarDragGroup => (
  value === 'library' || value === 'station' || value === 'nested' || value === 'unstationed'
);

export const parseSidebarDragPayload = (raw: string): SidebarDragPayload | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const { group, listKey, id } = parsed as {
      group?: unknown;
      listKey?: unknown;
      id?: unknown;
    };
    if (!isSidebarDragGroup(group) || typeof listKey !== 'string' || typeof id !== 'string') {
      return null;
    }

    if (!listKey || !id) {
      return null;
    }

    return { group, listKey, id };
  } catch {
    return null;
  }
};

export const encodeSidebarDragPayload = (payload: SidebarDragPayload): string => (
  JSON.stringify(payload)
);

export const reorderIds = (
  ids: string[],
  draggedId: string,
  targetId: string,
  placement: 'before' | 'after',
): string[] => {
  const next = ids.filter((id) => id !== draggedId);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex < 0) {
    return ids;
  }

  next.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, draggedId);
  return next;
};

export { mergePartialReorder } from '@/services/feeds/libraryRank';

export const clearSidebarDropClasses = (row: HTMLElement | null): void => {
  row?.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after');
};
