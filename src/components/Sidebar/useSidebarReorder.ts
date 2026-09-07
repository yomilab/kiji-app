import { useCallback, useEffect, useRef } from 'react';
import {
  abortSidebarListDrag,
  armSidebarClickSuppress,
  clearSidebarDropClasses,
  encodeSidebarDragPayload,
  isSidebarRowDragIgnored,
  parseSidebarDragPayload,
  registerSidebarDragAbort,
  unregisterSidebarDragAbort,
  reorderIds,
  type SidebarDragGroup,
} from './sidebarListDrag';
import { shouldRollbackLibraryReorder } from '@/services/feeds/libraryRank';

type DragState = {
  id: string;
  overId: string;
  placement: 'before' | 'after';
};

export const useSidebarReorder = <T,>(options: {
  group: SidebarDragGroup;
  listKey: string;
  items: T[];
  getId: (item: T) => string;
  persist: (ids: string[]) => Promise<void>;
  onReorder: (nextItems: T[]) => void;
  onRollback: () => void;
}) => {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const dragStateRef = useRef<DragState | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  const setRowRef = useCallback((id: string, node: HTMLElement | null) => {
    if (node) {
      rowRefs.current.set(id, node);
    } else {
      rowRefs.current.delete(id);
    }
  }, []);

  const applyDragState = useCallback((next: DragState | null) => {
    const previous = dragStateRef.current;
    if (previous) {
      clearSidebarDropClasses(rowRefs.current.get(previous.id) ?? null);
      clearSidebarDropClasses(rowRefs.current.get(previous.overId) ?? null);
    }

    dragStateRef.current = next;
    if (!next) {
      return;
    }

    rowRefs.current.get(next.id)?.classList.add('is-dragging');
    rowRefs.current.get(next.overId)?.classList.add(
      next.placement === 'after' ? 'is-drop-after' : 'is-drop-before',
    );
  }, []);

  const abort = useCallback(() => {
    if (dragStateRef.current) {
      armSidebarClickSuppress();
    }
    applyDragState(null);
  }, [applyDragState]);

  useEffect(() => {
    registerSidebarDragAbort(abort);
    const onVisibility = () => {
      if (document.hidden) {
        abortSidebarListDrag();
      }
    };
    const onBlur = () => abortSidebarListDrag();
    const onPointerCancel = () => abortSidebarListDrag();
    const abortIfOverlayActive = () => {
      if (document.querySelector('.app-container.article-view-active')) {
        abortSidebarListDrag();
      }
    };
    const overlayObserver = new MutationObserver(abortIfOverlayActive);
    const appRoot = document.querySelector('.app-container');
    if (appRoot) {
      overlayObserver.observe(appRoot, { attributes: true, attributeFilter: ['class'] });
    }
    window.addEventListener('blur', onBlur);
    window.addEventListener('pointercancel', onPointerCancel);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unregisterSidebarDragAbort(abort);
      overlayObserver.disconnect();
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointercancel', onPointerCancel);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [abort]);

  const onDragStart = useCallback((id: string, event: React.DragEvent) => {
    if (isSidebarRowDragIgnored(event.target)) {
      event.preventDefault();
      return;
    }

    const { group, listKey } = optionsRef.current;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', encodeSidebarDragPayload({ group, listKey, id }));
    const row = event.currentTarget;
    if (row instanceof HTMLElement) {
      event.dataTransfer.setDragImage(row, event.nativeEvent.offsetX, event.nativeEvent.offsetY);
    }
    applyDragState({ id, overId: id, placement: 'before' });
  }, [applyDragState]);

  const onDragOver = useCallback((targetId: string, event: React.DragEvent) => {
    const payload = parseSidebarDragPayload(event.dataTransfer.getData('text/plain'));
    const current = dragStateRef.current;
    const { group, listKey } = optionsRef.current;
    if (!current || current.id === targetId) {
      return;
    }

    if (payload && (payload.group !== group || payload.listKey !== listKey)) {
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY >= rect.top + rect.height / 2 ? 'after' : 'before';
    if (current.overId === targetId && current.placement === placement) {
      return;
    }

    applyDragState({ ...current, overId: targetId, placement });
  }, [applyDragState]);

  const onDrop = useCallback(async (_targetId: string, event: React.DragEvent) => {
    event.preventDefault();
    armSidebarClickSuppress();
    const current = dragStateRef.current;
    const { items, getId, persist, onReorder, onRollback, group, listKey } = optionsRef.current;
    applyDragState(null);
    if (!current) {
      return;
    }

    const payload = parseSidebarDragPayload(event.dataTransfer.getData('text/plain'));
    if (payload && (payload.group !== group || payload.listKey !== listKey)) {
      return;
    }

    const ids = items.map(getId);
    const nextIds = reorderIds(ids, current.id, current.overId, current.placement);
    if (nextIds.join('\0') === ids.join('\0')) {
      return;
    }

    const byId = new Map(items.map((item) => [getId(item), item]));
    const nextItems = nextIds
      .map((id) => byId.get(id))
      .filter((item): item is T => item !== undefined);
    onReorder(nextItems);
    try {
      await persist(nextIds);
    } catch (error) {
      if (shouldRollbackLibraryReorder(error)) {
        onRollback();
      }
    }
  }, [applyDragState]);

  const onDragEnd = useCallback(() => {
    if (dragStateRef.current) {
      armSidebarClickSuppress();
    }
    applyDragState(null);
  }, [applyDragState]);

  return {
    setRowRef,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
  };
};
