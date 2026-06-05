import React from 'react';
import dotsMoveSvg from '../../../assets/images/loading/3-dots-move.svg?raw';
import ringSvg from '../../../assets/images/loading/180-ring.svg?raw';
import './FeedLineLoader.css';

type FeedLineLoaderSize = 'sm' | 'md' | 'lg';
type FeedLineLoaderTone = 'default' | 'muted' | 'subtle';
type FeedLineLoaderVariant = 'dots' | 'ring';

interface FeedLineLoaderProps {
  size?: FeedLineLoaderSize | number;
  tone?: FeedLineLoaderTone;
  variant?: FeedLineLoaderVariant;
  color?: string;
  ariaLabel?: string;
}

const ICON_SIZE_MAP: Record<FeedLineLoaderSize, number> = {
  sm: 24,
  md: 30,
  lg: 36,
};

const DEFAULT_LOADER_INLINE_SVG = dotsMoveSvg
  .replace(/<\?xml[\s\S]*?\?>/g, '')
  .replace(/<!DOCTYPE[\s\S]*?>/g, '')
  .trim();
const RING_LOADER_INLINE_SVG = ringSvg
  .replace(/<\?xml[\s\S]*?\?>/g, '')
  .replace(/<!DOCTYPE[\s\S]*?>/g, '')
  .replace(/fill="[^"]*"/g, 'fill="currentColor"')
  .trim();

export const FeedLineLoader: React.FC<FeedLineLoaderProps> = ({
  size = 'md',
  tone = 'default',
  variant = 'dots',
  color,
  ariaLabel = 'Loading',
}) => {
  const iconSizePx = typeof size === 'number' ? size : ICON_SIZE_MAP[size];
  const loaderStyle = {
    '--feed-line-loader-size': `${iconSizePx}px`,
  } as React.CSSProperties & Partial<Record<'--feed-line-loader-color', string>>;

  if (color) {
    loaderStyle['--feed-line-loader-color'] = color;
  }

  const loaderSvg = variant === 'ring' ? RING_LOADER_INLINE_SVG : DEFAULT_LOADER_INLINE_SVG;

  return (
    <div
      className="feed-line-loader"
      data-tone={tone}
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      style={loaderStyle}
    >
      <span
        className="feed-line-loader-icon"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: loaderSvg }}
      />
    </div>
  );
};
