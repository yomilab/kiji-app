export const LAYOUT_COLUMN_RESIZING_CLASS = 'layout-col-resizing';

export type LayoutColumnResizeOwner = 'sidebar' | 'article-list';

let isLocked = false;
let lockOwner: LayoutColumnResizeOwner | null = null;

const preventSelectStart = (event: Event): void => {
  event.preventDefault();
};

export const beginLayoutColumnResize = (
  event: { button?: number; preventDefault(): void; stopPropagation(): void },
  owner: LayoutColumnResizeOwner,
): boolean => {
  if (event.button !== undefined && event.button !== 0) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  window.getSelection()?.removeAllRanges();
  document.body.classList.add(LAYOUT_COLUMN_RESIZING_CLASS);

  if (!isLocked) {
    isLocked = true;
    document.addEventListener('selectstart', preventSelectStart, true);
  }
  lockOwner = owner;

  return true;
};

export const endLayoutColumnResize = (owner?: LayoutColumnResizeOwner): void => {
  if (owner && lockOwner && lockOwner !== owner) {
    return;
  }

  if (isLocked) {
    isLocked = false;
    document.removeEventListener('selectstart', preventSelectStart, true);
  }

  lockOwner = null;
  document.body.classList.remove(LAYOUT_COLUMN_RESIZING_CLASS);
};
