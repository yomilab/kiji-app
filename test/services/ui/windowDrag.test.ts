import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve()),
  startDragging: vi.fn(() => Promise.resolve()),
  toggleMaximize: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ startDragging: mocks.startDragging, toggleMaximize: mocks.toggleMaximize }),
}));

import { startWindowDrag } from '@/services/ui/windowDrag';
import {
  WINDOW_DRAG_REGION_ATTR,
  WINDOW_DRAG_REGION_DEEP,
  installWindowDragRegions,
} from '@/services/ui/windowChromeDragRegion';

const mouse = (type: string, init: MouseEventInit): MouseEvent =>
  new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });

const listSourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return listSourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.stories\.tsx$/.test(name) ? [path] : [];
  });

describe('window drag (macOS 27)', () => {
  let uninstall: (() => void) | null = null;

  beforeEach(() => {
    mocks.invoke.mockClear();
    mocks.startDragging.mockClear();
    mocks.toggleMaximize.mockClear();
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
    document.body.replaceChildren();
  });

  const dragStrip = (): { strip: HTMLElement; title: HTMLElement; button: HTMLElement } => {
    const strip = document.createElement('div');
    strip.setAttribute(WINDOW_DRAG_REGION_ATTR, WINDOW_DRAG_REGION_DEEP);
    const title = document.createElement('h2');
    const button = document.createElement('button');
    strip.append(title, button);
    document.body.appendChild(strip);
    return { strip, title, button };
  };

  it('starts the drag through the plain command, not the async startDragging', () => {
    startWindowDrag();

    expect(mocks.invoke).toHaveBeenCalledWith('shell_window_drag_start');
    expect(mocks.startDragging).not.toHaveBeenCalled();
  });

  it('drags the window from a press in a drag strip and keeps it from other listeners', () => {
    uninstall = installWindowDragRegions('macos');
    const { title } = dragStrip();
    const later = vi.fn();
    document.addEventListener('mousedown', later);

    const event = mouse('mousedown', { detail: 1 });
    title.dispatchEvent(event);
    document.removeEventListener('mousedown', later);

    expect(mocks.invoke).toHaveBeenCalledWith('shell_window_drag_start');
    expect(event.defaultPrevented).toBe(true);
    expect(later).not.toHaveBeenCalled();
  });

  it('leaves buttons in a drag strip clickable', () => {
    uninstall = installWindowDragRegions('macos');
    const { button } = dragStrip();

    const event = mouse('mousedown', { detail: 1 });
    button.dispatchEvent(event);

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('zooms on a macOS double-click only when the mouse comes up where it went down', () => {
    uninstall = installWindowDragRegions('macos');
    const { title } = dragStrip();

    title.dispatchEvent(mouse('mousedown', { detail: 2, clientX: 40, clientY: 10 }));
    expect(mocks.toggleMaximize).not.toHaveBeenCalled();
    title.dispatchEvent(mouse('mouseup', { detail: 2, clientX: 60, clientY: 10 }));
    expect(mocks.toggleMaximize).not.toHaveBeenCalled();

    title.dispatchEvent(mouse('mousedown', { detail: 2, clientX: 40, clientY: 10 }));
    title.dispatchEvent(mouse('mouseup', { detail: 2, clientX: 40, clientY: 10 }));
    expect(mocks.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('zooms on the second press on Windows and Linux', () => {
    uninstall = installWindowDragRegions('windows');
    const { title } = dragStrip();

    title.dispatchEvent(mouse('mousedown', { detail: 2 }));

    expect(mocks.toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it('stops listening after uninstall', () => {
    installWindowDragRegions('macos')();
    const { title } = dragStrip();

    title.dispatchEvent(mouse('mousedown', { detail: 1 }));

    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('keeps every strip off the paths macOS 27 ignores', () => {
    for (const file of listSourceFiles(join(process.cwd(), 'src'))) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toContain('.startDragging(');
      // Tauri's injected drag.js starts the drag through startDragging for this attribute.
      expect(source, file).not.toMatch(/data-tauri-drag-region(\s*=|\s*\/?>|\s+[a-z])|['"]data-tauri-drag-region['"]/);
    }
  });
});
