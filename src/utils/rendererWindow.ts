export type RendererWindowType = 'main' | 'settings' | 'article' | 'update' | 'version';

export function getRendererWindowType(): RendererWindowType {
  const windowType = new URLSearchParams(window.location.search).get('window');
  if (windowType === 'settings' || windowType === 'article' || windowType === 'update' || windowType === 'version') {
    return windowType;
  }
  return 'main';
}

export function isMainRendererWindow(): boolean {
  return getRendererWindowType() === 'main';
}
