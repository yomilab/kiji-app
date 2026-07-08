export type RendererWindowType = 'main' | 'settings' | 'article' | 'update';

export function getRendererWindowType(): RendererWindowType {
  const windowType = new URLSearchParams(window.location.search).get('window');
  if (windowType === 'settings' || windowType === 'article' || windowType === 'update') {
    return windowType;
  }
  return 'main';
}

export function isMainRendererWindow(): boolean {
  return getRendererWindowType() === 'main';
}
