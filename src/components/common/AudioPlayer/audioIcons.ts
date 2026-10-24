/** Material icon paths (24×24) shared by the inline player and the mini player. */
export const AUDIO_ICONS = {
  play: 'M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z',
  pause: 'M7 5h3.2v14H7zM13.8 5H17v14h-3.2z',
  replay: 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  playlistAdd: 'M14 10H3v2h11v-2zm0-4H3v2h11V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM3 16h7v-2H3v2z',
  playlistAdded: 'M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm19.5-4.5L23 13l-6.99 7-4.51-4.5L13 14l3.01 3 6.49-6.5z',
  queue: 'M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  waveform: 'M7 18h2V6H7v12zm4 4h2V2h-2v20zm-8-8h2v-4H3v4zm12 4h2V6h-2v12zm4-8v4h2v-4h-2z',
} as const;

/** Circular-arrow skip icon with the seconds drawn inside; mirrored for forward. */
export function skipIconSvg(seconds: number, direction: 'back' | 'forward'): string {
  const flip = direction === 'forward' ? ' transform="matrix(-1 0 0 1 24 0)"' : '';
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path${flip} d="${AUDIO_ICONS.replay}"/>`
    + `<text x="12" y="16.1" text-anchor="middle" font-size="6.4" font-weight="700" fill="currentColor">${seconds}</text></svg>`;
}

export function iconSvg(path: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
}
