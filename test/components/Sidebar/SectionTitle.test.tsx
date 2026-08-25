import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEvent, fireEvent, render } from '@testing-library/react';
import { SectionTitle } from '@/components/Sidebar/SectionTitle';

describe('SectionTitle', () => {
  it('places a hover-target toggle button after the title', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <SectionTitle
        title="Library"
        sectionId="library"
        expanded={true}
        onToggle={onToggle}
      />,
    );

    const header = container.querySelector('[data-component="section-title"]');
    const title = container.querySelector('.section-title-text');
    const button = container.querySelector('[data-action="toggle-section"]');
    expect(header).not.toBeNull();
    expect(header?.getAttribute('data-section')).toBe('library');
    expect(header?.getAttribute('data-expanded')).toBe('true');
    expect(title?.textContent).toBe('Library');
    expect(button).not.toBeNull();
    expect(button?.classList.contains('section-title-toggle')).toBe(true);
    expect(title?.compareDocumentPosition(button as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(button?.getAttribute('aria-label')).toBe('Collapse Library');
  });

  it('calls onToggle from the button and rotates the arrow when collapsed', () => {
    const onToggle = vi.fn();
    const { container, rerender } = render(
      <SectionTitle
        title="Stations"
        sectionId="stations"
        expanded={true}
        onToggle={onToggle}
      />,
    );

    const button = container.querySelector('[data-action="toggle-section"]');
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLButtonElement);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <SectionTitle
        title="Stations"
        sectionId="stations"
        expanded={false}
        onToggle={onToggle}
      />,
    );

    const header = container.querySelector('[data-component="section-title"]');
    expect(header?.getAttribute('data-expanded')).toBe('false');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.getAttribute('aria-label')).toBe('Expand Stations');
    expect(container.querySelector('.section-title-toggle-icon')).not.toBeNull();
  });

  it('prevents a pointer press from focusing the toggle', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <SectionTitle
        title="Library"
        sectionId="library"
        expanded={true}
        onToggle={onToggle}
      />,
    );

    const button = container.querySelector('[data-action="toggle-section"]') as HTMLButtonElement;
    const mouseDown = createEvent.mouseDown(button, { button: 0 });
    fireEvent(button, mouseDown);
    expect(mouseDown.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(button);
  });

  it('does not define a separate :active pressed fill', () => {
    const cssPath = fileURLToPath(
      new URL('../../../src/components/Sidebar/SectionTitle.css', import.meta.url),
    );
    const css = readFileSync(cssPath, 'utf8');
    expect(css).not.toMatch(/section-title-toggle:active/);
  });
});
