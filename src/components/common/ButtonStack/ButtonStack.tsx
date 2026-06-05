import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import type { SvgIconComponent } from '@mui/icons-material';
import './ButtonStack.css';

export interface ButtonConfig {
  id: string;
  icon: SvgIconComponent;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
}

export interface ButtonStackProps {
  buttons: ButtonConfig[];
  direction?: 'right' | 'left' | 'up' | 'down';
  spacing?: number;
  buttonSize?: number;
  coverIcon?: SvgIconComponent;
  coverLabel?: string;
  onCoverClick?: (e: React.MouseEvent) => void;
  layoutMode?: 'overlay' | 'push';
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  className?: string;
}

const BUTTON_SIZE_PX = 28;

export const ButtonStack: React.FC<ButtonStackProps> = ({
  buttons,
  direction = 'right',
  spacing,
  buttonSize,
  coverIcon: CoverIcon = MoreVertIcon,
  coverLabel = 'More actions',
  onCoverClick,
  layoutMode = 'overlay',
  expanded,
  defaultExpanded = false,
  onExpandedChange,
  className = '',
}) => {
  const isControlled = expanded !== undefined;
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isExpanded = isControlled ? expanded : internalExpanded;
  const rootRef = useRef<HTMLDivElement>(null);
  const prevExpandedRef = useRef<boolean>(isExpanded);
  const [resolvedSpacing, setResolvedSpacing] = useState(spacing ?? buttonSize ?? BUTTON_SIZE_PX);

  const parseCssPx = (value: string): number | null => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const setExpandedState = (next: boolean) => {
    if (!isControlled) {
      setInternalExpanded(next);
    }

    if (prevExpandedRef.current !== next) {
      prevExpandedRef.current = next;
      onExpandedChange?.(next);
    }
  };

  useEffect(() => {
    prevExpandedRef.current = isExpanded;
  }, [isExpanded]);

  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;

    const computed = window.getComputedStyle(element);
    const cssButtonSize = parseCssPx(computed.getPropertyValue('--button-stack-button-size'));
    const cssSpacing = parseCssPx(computed.getPropertyValue('--button-stack-spacing'));

    const nextButtonSize = buttonSize ?? cssButtonSize ?? BUTTON_SIZE_PX;
    const nextSpacing = spacing ?? cssSpacing ?? nextButtonSize;

    setResolvedSpacing(nextSpacing);
  }, [buttonSize, spacing, className]);

  const getButtonOffset = (index: number) => {
    if (!isExpanded) return { x: 0, y: 0 };

    const offset = (index + 1) * resolvedSpacing;

    switch (direction) {
      case 'right':
        return { x: offset, y: 0 };
      case 'left':
        return { x: -offset, y: 0 };
      case 'up':
        return { y: -offset, x: 0 };
      case 'down':
        return { y: offset, x: 0 };
      default:
        return { x: offset, y: 0 };
    }
  };

  const handleButtonClick = (e: React.MouseEvent, button: ButtonConfig) => {
    e.stopPropagation();
    if (!button.disabled) {
      button.onClick(e);
    }
  };

  const handleBlurCapture = (e: React.FocusEvent<HTMLDivElement>) => {
    const nextFocus = e.relatedTarget as Node | null;
    if (!rootRef.current?.contains(nextFocus)) {
      setExpandedState(false);
    }
  };

  const stackStyle = useMemo((): React.CSSProperties => {
    const vars: React.CSSProperties & Record<string, string | number | undefined> = {
      '--button-stack-count': String(buttons.length),
    };

    if (buttonSize !== undefined) {
      vars['--button-stack-button-size'] = `${buttonSize}px`;
    }

    if (spacing !== undefined) {
      vars['--button-stack-spacing'] = `${spacing}px`;
    }

    return vars;
  }, [buttons.length, buttonSize, spacing]);

  return (
    <div
      ref={rootRef}
      className={`button-stack ${className}`}
      data-layout-mode={layoutMode}
      data-direction={direction}
      data-expanded={isExpanded ? 'true' : 'false'}
      style={stackStyle}
      onMouseEnter={() => setExpandedState(true)}
      onMouseLeave={() => setExpandedState(false)}
      onFocusCapture={() => setExpandedState(true)}
      onBlurCapture={handleBlurCapture}
    >
      {/* Action buttons (rendered first, below cover) */}
      {buttons.map((button, index) => {
        const Icon = button.icon;
        const offset = getButtonOffset(index);
        const zIndex = buttons.length - index;

        return (
          <motion.button
            key={button.id}
            className="button-stack-button"
            onClick={(e) => handleButtonClick(e, button)}
            disabled={button.disabled}
            aria-label={button.label}
            title={button.label}
            style={{ zIndex }}
            animate={{
              x: offset.x,
              y: offset.y,
              opacity: isExpanded ? 1 : 0,
            }}
            transition={{
              duration: 0.15,
              ease: 'easeInOut',
              delay: index * 0.02,
            }}
          >
            <Icon sx={{ fontSize: 'var(--button-stack-icon-size, 1em)' }} />
          </motion.button>
        );
      })}

      {/* Cover button (always visible, highest z-index) */}
      <button
        className="button-stack-cover"
        onClick={(e) => {
          e.stopPropagation();
          onCoverClick?.(e);
        }}
        aria-label={coverLabel}
        title={coverLabel}
        style={{ zIndex: buttons.length + 1 }}
      >
        <CoverIcon sx={{ fontSize: 'var(--button-stack-icon-size, 1em)' }} />
      </button>
    </div>
  );
};
