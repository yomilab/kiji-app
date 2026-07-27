import { describe, expect, it } from 'vitest';

import { sanitizeArticleHtmlStyles } from '@/services/articles/articleStyleSanitizer';

describe('sanitizeArticleHtmlStyles navigation guards', () => {
  it('defers iframe src so first paint cannot trigger webview navigations', () => {
    const html = '<p>text</p><iframe src="https://datawrapper.dwcdn.net/wxXLO/1/" width="730" height="444"></iframe>';

    const result = sanitizeArticleHtmlStyles(html);
    const doc = new DOMParser().parseFromString(result, 'text/html');
    const iframe = doc.querySelector('iframe');

    expect(iframe?.getAttribute('src')).toBeNull();
    expect(iframe?.getAttribute('data-pending-src')).toBe('https://datawrapper.dwcdn.net/wxXLO/1/');
  });

  it('strips iframe srcdoc so inline frame documents cannot execute', () => {
    const html = '<iframe srcdoc="<script>top.location.href=\'https://evil.example\'</script>"></iframe>';

    const result = sanitizeArticleHtmlStyles(html);
    const doc = new DOMParser().parseFromString(result, 'text/html');

    expect(doc.querySelector('iframe')?.getAttribute('srcdoc')).toBeNull();
  });

  it('removes meta refresh directives but keeps other meta tags', () => {
    const html = '<meta http-equiv="refresh" content="0;url=https://evil.example"><meta http-equiv="content-type" content="text/html"><p>text</p>';

    const result = sanitizeArticleHtmlStyles(html);
    const doc = new DOMParser().parseFromString(result, 'text/html');
    const directives = Array.from(doc.querySelectorAll('meta[http-equiv]'))
      .map((element) => element.getAttribute('http-equiv')?.toLowerCase());

    expect(directives).not.toContain('refresh');
    expect(doc.querySelector('p')?.textContent).toBe('text');
  });
});
