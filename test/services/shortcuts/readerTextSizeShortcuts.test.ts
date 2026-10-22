import { afterEach, describe, expect, it } from 'vitest';
import { getReaderTextSizeShortcutAction, SHORTCUT_LABELS } from '@/services/shortcuts/shortcutService';
import { SHORTCUT_GROUPS } from '@/components/SettingsWindow/panes/ShortcutsPane';

const key = (value: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key: value,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

const openStandaloneArticle = () => {
  const view = document.createElement('div');
  view.className = 'article-view-window';
  document.body.appendChild(view);
};

describe('reader text size shortcuts', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('maps Cmd/Ctrl + plus, equals, minus and zero while an article is open', () => {
    openStandaloneArticle();
    expect(getReaderTextSizeShortcutAction(key('=', { metaKey: true }))).toBe('bigger');
    expect(getReaderTextSizeShortcutAction(key('+', { metaKey: true, shiftKey: true }))).toBe('bigger');
    expect(getReaderTextSizeShortcutAction(key('-', { ctrlKey: true }))).toBe('smaller');
    expect(getReaderTextSizeShortcutAction(key('0', { metaKey: true }))).toBe('reset');
  });

  it('ignores the keys without a modifier, with Option, or with no article open', () => {
    openStandaloneArticle();
    expect(getReaderTextSizeShortcutAction(key('='))).toBeNull();
    expect(getReaderTextSizeShortcutAction(key('=', { metaKey: true, altKey: true }))).toBeNull();
    document.body.innerHTML = '';
    expect(getReaderTextSizeShortcutAction(key('=', { metaKey: true }))).toBeNull();
  });

  it('ignores the keys while a modal is open over the article', () => {
    openStandaloneArticle();
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    document.body.appendChild(modal);
    expect(getReaderTextSizeShortcutAction(key('=', { metaKey: true }))).toBeNull();
  });

  it('lists the keys in Settings → Shortcuts', () => {
    const article = SHORTCUT_GROUPS.find((group) => group.id === 'article');
    expect(article?.items.map((item) => item.keys)).toEqual(expect.arrayContaining([
      SHORTCUT_LABELS.READER_TEXT_BIGGER,
      SHORTCUT_LABELS.READER_TEXT_SMALLER,
      SHORTCUT_LABELS.READER_TEXT_RESET,
    ]));
  });
});
