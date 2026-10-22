import { afterEach, describe, expect, it } from 'vitest';
import { isMarkAllReadShortcut, SHORTCUT_LABELS } from '@/services/shortcuts/shortcutService';

const key = (overrides: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({
  key: 'K',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe('Mark All as Read shortcut', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is Shift+Cmd+K on macOS and Ctrl+Shift+K elsewhere', () => {
    expect(isMarkAllReadShortcut(key({ metaKey: true, shiftKey: true }))).toBe(true);
    expect(isMarkAllReadShortcut(key({ ctrlKey: true, shiftKey: true, key: 'k' }))).toBe(true);
    expect(SHORTCUT_LABELS.MARK_ALL_READ).toBe('Cmd + Shift + K');
  });

  it('leaves Cmd+K (command palette), plain K (step up) and Alt combos alone', () => {
    expect(isMarkAllReadShortcut(key({ metaKey: true, key: 'k' }))).toBe(false);
    expect(isMarkAllReadShortcut(key({ key: 'k' }))).toBe(false);
    expect(isMarkAllReadShortcut(key({ shiftKey: true }))).toBe(false);
    expect(isMarkAllReadShortcut(key({ metaKey: true, shiftKey: true, altKey: true }))).toBe(false);
  });

  it('does nothing while a modal is open', () => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    document.body.appendChild(backdrop);
    expect(isMarkAllReadShortcut(key({ metaKey: true, shiftKey: true }))).toBe(false);
  });
});
