/** Attribute on the focusable part of every sidebar source row. */
export const SIDEBAR_NAV_ITEM_ATTR = 'data-sidebar-nav-item';

const NAV_ITEM_SELECTOR = `[${SIDEBAR_NAV_ITEM_ATTR}]`;

/** Rows a keyboard user can reach: folded sections keep their rows mounted but hidden. */
export function listSidebarNavItems(container: ParentNode): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(NAV_ITEM_SELECTOR)).filter(
    (item) => item.closest('.sidebar-section-body:not(.is-expanded)') === null,
  );
}

/**
 * Source list keys (one Tab stop, arrows move between rows, like a macOS
 * source list): Up/Down, Home/End move focus; Enter/Space select the row.
 * Returns true when the key was handled.
 */
export function handleSidebarNavKeyDown(
  event: Pick<KeyboardEvent, 'key' | 'target' | 'metaKey' | 'ctrlKey' | 'altKey' | 'preventDefault'>,
  container: ParentNode,
): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.matches(NAV_ITEM_SELECTOR)) return false;

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    target.click();
    return true;
  }

  const items = listSidebarNavItems(container);
  const index = items.indexOf(target);
  if (index === -1) return false;

  let next: HTMLElement | undefined;
  if (event.key === 'ArrowDown') next = items[index + 1];
  else if (event.key === 'ArrowUp') next = items[index - 1];
  else if (event.key === 'Home') next = items[0];
  else if (event.key === 'End') next = items[items.length - 1];
  else return false;

  event.preventDefault();
  next?.focus();
  return true;
}

/** Spoken name of a source row: "Unread, 12 unread". */
export function sidebarRowLabel(title: string, unreadCount?: number | null): string {
  return unreadCount && unreadCount > 0 ? `${title}, ${unreadCount} unread` : title;
}
