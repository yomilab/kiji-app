import type { SidebarSectionId } from './SectionTitle';

export const resolveHoveredSidebarSectionFromNode = (
  hit: EventTarget | null,
): SidebarSectionId | null => {
  if (!(hit instanceof Element)) {
    return null;
  }

  const title = hit.closest('[data-component="section-title"]');
  const id = title?.getAttribute('data-section');
  return id === 'library' || id === 'stations' ? id : null;
};

export const resolveHoveredSidebarSection = (
  clientX: number,
  clientY: number,
): SidebarSectionId | null => {
  return resolveHoveredSidebarSectionFromNode(document.elementFromPoint(clientX, clientY));
};
