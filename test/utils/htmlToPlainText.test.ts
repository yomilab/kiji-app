import { describe, expect, it } from 'vitest';
import { htmlToPlainText, normalizeStoredDescription } from '@/utils/htmlToPlainText';

describe('htmlToPlainText', () => {
  it('decodes numeric HTML entities in feed summaries', () => {
    const encoded = '&#25298;&#32477;&#20013;&#22269;&#38712;&#20940;&#65306;&#26085;&#26412;&#22269;&#27665;&#38598;&#20307;&#25674;&#29260;';
    const plain = htmlToPlainText(encoded);

    expect(plain).toContain('拒');
    expect(plain).toContain('中');
    expect(plain).not.toContain('&#');
  });

  it('strips tags and decodes entities in HTML snippets', () => {
    const html = '<p>2026&#24180;&#21018;&#21018;&#36807;&#21435;</p>';
    const plain = htmlToPlainText(html);

    expect(plain).toContain('2026');
    expect(plain).toContain('年');
    expect(plain).not.toContain('<p>');
  });
});

describe('normalizeStoredDescription', () => {
  it('repairs legacy entity-encoded descriptions on read', () => {
    const encoded = '&#25298;&#32477;&#20013;&#22269;';
    expect(normalizeStoredDescription(encoded)).toBe('拒绝中国');
  });

  it('leaves already-plain descriptions unchanged', () => {
    const plain = '拒绝中国';
    expect(normalizeStoredDescription(plain)).toBe(plain);
  });
});
