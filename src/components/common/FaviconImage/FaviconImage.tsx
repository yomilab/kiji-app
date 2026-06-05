import React, { useState } from 'react';
import StarIcon from '@mui/icons-material/Star';
import { DEFAULT_FEED_EMOJI } from '@/constants';
import './FaviconImage.css';

interface FaviconImageProps {
  /** Locally stored favicon (base64 data URL) - highest priority */
  localFavicon?: string;
  /** Remote image URL (feed.image or other remote source) - fallback */
  remoteImage?: string;
  /** Custom emoji to display if no images available */
  emoji?: string;
  /** Optional per-instance default emoji fallback when no favicon is available */
  fallbackEmoji?: string;
  /** Optional per-instance default icon fallback when no favicon is available */
  fallbackIcon?: React.ReactNode;
  /** Alt text for accessibility */
  alt?: string;
  /** Unique identifier for error tracking */
  itemId?: string;
  /** Persisted transparency hint for contrast background */
  hasTransparency?: boolean;
}

interface FaviconContainerProps {
  children: React.ReactNode;
  hasTransparency?: boolean;
}

/**
 * Check if a string is a base64 data URL
 */
const isBase64DataUrl = (str: string): boolean => {
  return str.startsWith('data:');
};

const DEFAULT_FEED_FALLBACK_ICON = <StarIcon sx={{ fontSize: '1.1rem' }} />;

const FaviconContainer: React.FC<FaviconContainerProps> = ({
  children,
  hasTransparency = false,
}) => {
  return (
    <span
      className={`favicon-container ${hasTransparency ? 'has-transparent-pixels' : ''}`}
    >
      {children}
    </span>
  );
};

/**
 * FaviconImage component displays favicons with fallback priority:
 * 1. Custom emoji (if explicitly set)
 * 2. Local stored favicon (base64 data URL only - no network requests)
 * 3. Default icon
 * 4. Default emoji
 */
export const FaviconImage: React.FC<FaviconImageProps> = ({
  localFavicon,
  emoji,
  fallbackEmoji,
  fallbackIcon = DEFAULT_FEED_FALLBACK_ICON,
  alt = '',
  itemId,
  hasTransparency,
}) => {
  const [localFaviconError, setLocalFaviconError] = useState(false);

  // Priority 1: Custom emoji (highest priority if explicitly set)
  if (emoji) {
    return (
      <FaviconContainer>
        <span className="favicon-emoji">{emoji}</span>
      </FaviconContainer>
    );
  }

  // Check if localFavicon is actually a base64 data URL
  const isLocalBase64 = localFavicon && isBase64DataUrl(localFavicon);
  const effectiveTransparency = hasTransparency ?? false;

  // Priority 2: Local stored favicon (base64 data URL only)
  if (isLocalBase64 && !localFaviconError) {
    return (
      <FaviconContainer
        hasTransparency={effectiveTransparency}
      >
        <img
          src={localFavicon}
          alt={alt}
          className="favicon-image"
          onError={() => {
            console.warn('[FaviconImage] Failed to load favicon for:', itemId);
            setLocalFaviconError(true);
          }}
        />
      </FaviconContainer>
    );
  }

  // Priority 3: Default icon fallback
  if (fallbackIcon) {
    return (
      <FaviconContainer>
        <span className="favicon-icon">{fallbackIcon}</span>
      </FaviconContainer>
    );
  }

  // Priority 4: Default emoji fallback
  return (
    <FaviconContainer>
      <span className="favicon-emoji">{fallbackEmoji || DEFAULT_FEED_EMOJI}</span>
    </FaviconContainer>
  );
};
