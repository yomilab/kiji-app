import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import { keybindingService } from '@/services/shortcuts/shortcutService';
import './EmojiSubmenu.css';

interface EmojiSubmenuProps {
  isOpen: boolean;
  anchorEl: HTMLElement | null;
  position: 'left' | 'right';
  onEmojiSelect: (emoji: string) => void;
  onClose: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  selectedEmoji?: string;
}

interface EmojiSelection {
  native: string;
}

export const EmojiSubmenu: React.FC<EmojiSubmenuProps> = ({
  isOpen,
  anchorEl,
  position,
  onEmojiSelect,
  onClose,
  onMouseEnter,
  onMouseLeave,
  selectedEmoji: _selectedEmoji,
}) => {
  void _selectedEmoji;
  const [submenuPosition, setSubmenuPosition] = useState<{ x: number; y: number } | null>(null);
  const submenuRef = useRef<HTMLDivElement>(null);

  const calculatePosition = useCallback(() => {
    if (!anchorEl) return null;

    const anchorRect = anchorEl.getBoundingClientRect();
    const submenuWidth = 420; // Match emoji-mart width used in modal
    const submenuHeight = 400; // Match emoji-mart height used in modal
    const gap = 8; // Space between anchor and submenu

    let x = 0;
    let y = anchorRect.top;

    // Horizontal positioning
    if (position === 'left') {
      x = anchorRect.left - submenuWidth - gap;
      // If overflows left edge, flip to right
      if (x < 10) {
        x = anchorRect.right + gap;
      }
    } else {
      x = anchorRect.right + gap;
      // If overflows right edge, flip to left
      if (x + submenuWidth > window.innerWidth - 10) {
        x = anchorRect.left - submenuWidth - gap;
      }
    }

    // Vertical positioning - keep within viewport
    if (y + submenuHeight > window.innerHeight - 10) {
      y = window.innerHeight - submenuHeight - 10;
    }
    if (y < 10) {
      y = 10;
    }

    return { x, y };
  }, [anchorEl, position]);

  useLayoutEffect(() => {
    if (!isOpen || !anchorEl) {
      setSubmenuPosition(null);
      return;
    }

    setSubmenuPosition(calculatePosition());
  }, [isOpen, anchorEl, calculatePosition]);

  useEffect(() => {
    if (!isOpen || !anchorEl) return;

    const updatePosition = () => {
      setSubmenuPosition(calculatePosition());
    };

    // Re-run once on next frame in case surrounding layout is still animating.
    const rafId = window.requestAnimationFrame(updatePosition);

    // Recalculate on scroll or resize
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, anchorEl, calculatePosition]);

  useEffect(() => {
    if (!isOpen) return;

    return keybindingService.register({
      type: 'keydown',
      priority: 210,
      handler: (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
        }
      },
    });
  }, [isOpen, onClose]);

  if (!isOpen || !submenuPosition) return null;

  const handleEmojiClick = (emoji: EmojiSelection) => {
    onEmojiSelect(emoji.native);
  };

  return createPortal(
    <div
      ref={submenuRef}
      className={`emoji-submenu ${isOpen ? 'emoji-submenu-open' : ''}`}
      style={{
        position: 'fixed',
        left: `${submenuPosition.x}px`,
        top: `${submenuPosition.y}px`,
        zIndex: 2001,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="emoji-submenu-picker-wrapper">
        <Picker
          data={data}
          onEmojiSelect={handleEmojiClick}
          theme="auto"
          previewPosition="none"
          skinTonePosition="none"
          searchPosition="sticky"
          perLine={9}
          emojiSize={24}
          emojiButtonSize={32}
          maxFrequentRows={2}
        />
      </div>
    </div>,
    document.body
  );
};
