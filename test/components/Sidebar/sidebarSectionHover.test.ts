import { describe, it, expect } from 'vitest';
import { resolveHoveredSidebarSectionFromNode } from '@/components/Sidebar/sidebarSectionHover';

describe('resolveHoveredSidebarSectionFromNode', () => {
  it('returns the section when the node is on the section title', () => {
    const section = document.createElement('div');
    section.setAttribute('data-component', 'sidebar-section');
    section.setAttribute('data-section', 'stations');
    const title = document.createElement('div');
    title.setAttribute('data-component', 'section-title');
    title.setAttribute('data-section', 'stations');
    const child = document.createElement('button');
    title.appendChild(child);
    section.appendChild(title);
    const body = document.createElement('div');
    body.setAttribute('data-component', 'sidebar-section-body');
    section.appendChild(body);

    expect(resolveHoveredSidebarSectionFromNode(child)).toBe('stations');
    expect(resolveHoveredSidebarSectionFromNode(title)).toBe('stations');
    expect(resolveHoveredSidebarSectionFromNode(body)).toBeNull();
    expect(resolveHoveredSidebarSectionFromNode(section)).toBeNull();
  });

  it('returns null when the node is outside every section', () => {
    const nav = document.createElement('div');
    nav.setAttribute('data-component', 'sidebar-nav');

    expect(resolveHoveredSidebarSectionFromNode(nav)).toBeNull();
    expect(resolveHoveredSidebarSectionFromNode(null)).toBeNull();
  });
});
