import React from 'react';
import { motion } from 'motion/react';
import './StatefulButtonGroup.css';

export type AnimationDirection = 'slide-down' | 'slide-up' | 'slide-left' | 'slide-right' | 'fade' | 'scale' | 'auto';

export interface ButtonState {
  /** Unique identifier for this state */
  key: string;
  /** Icon component to render */
  icon: React.ReactNode;
  /** Accessible label for screen readers */
  ariaLabel: string;
  /** Tooltip text */
  title: string;
}

export interface AnimationConfig {
  /** Animation direction (default: 'auto' - slides down when going forward, up when going backward) */
  direction?: AnimationDirection;
  /** Animation duration in seconds (default: 0.2) */
  duration?: number;
  /** Spring bounce (0-1, default: 0.15) */
  bounce?: number;
}

export interface StatefulButtonGroupProps {
  /** Array of button states */
  states: ButtonState[];
  /** Current active state index */
  currentStateIndex: number;
  /** Callback when button is clicked - receives next state index */
  onChange: (nextStateIndex: number) => void;
  /** Animation configuration */
  animationConfig?: AnimationConfig;
  /** Additional CSS class for the button */
  className?: string;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Custom button size class token: 'is-small', 'is-medium', 'is-large' */
  size?: 'is-small' | 'is-medium' | 'is-large';
  /** Whether the button is in a loading/in-between state */
  isLoading?: boolean;
  /** Custom data attributes */
  [key: `data-${string}`]: any;
}

/**
 * StatefulButtonGroup - A configurable icon button component with animated state transitions
 *
 * Perfect for toggle buttons, mode switchers, or any icon button that cycles through states.
 * Uses Motion library for smooth animations with configurable directions and timing.
 *
 * @example
 * ```tsx
 * const states = [
 *   { key: 'reader', icon: <ReaderIcon />, ariaLabel: 'Reader mode', title: 'Switch to reader mode' },
 *   { key: 'basic', icon: <ArticleIcon />, ariaLabel: 'Basic view', title: 'Switch to basic view' }
 * ];
 *
 * <StatefulButtonGroup
 *   states={states}
 *   currentStateIndex={isReaderMode ? 0 : 1}
 *   onChange={(nextIndex) => setIsReaderMode(nextIndex === 0)}
 *   animationConfig={{ direction: 'slide-down', duration: 0.2 }}
 * />
 * ```
 */
export const StatefulButtonGroup: React.FC<StatefulButtonGroupProps> = ({
  states,
  currentStateIndex,
  onChange,
  animationConfig = {},
  className = '',
  disabled = false,
  size = 'is-small',
  isLoading = false,
  ...rest
}) => {
  const {
    duration = 0.2,
  } = animationConfig;

  // Filter out data attributes from rest
  const dataAttributes = Object.keys(rest)
    .filter((key) => key.startsWith('data-'))
    .reduce((obj, key) => {
      obj[key] = (rest as any)[key];
      return obj;
    }, {} as Record<string, any>);

  // Validate state index
  const validIndex = Math.max(0, Math.min(currentStateIndex, states.length - 1));
  const currentState = states[validIndex];

  const handleClick = () => {
    if (disabled || isLoading) return;
    // Cycle to next state
    const nextIndex = (validIndex + 1) % states.length;
    onChange(nextIndex);
  };

  // Calculate the container offset based on current state
  // Icon size is controlled by CSS variable --widget-button-icon-size (18px)
  // Add padding for comfortable click area
  const iconHeight = size === 'is-small' ? 18 : size === 'is-medium' ? 24 : 28;
  const containerOffset = -validIndex * iconHeight;

  return (
    <button
      onClick={handleClick}
      className={`button is-text ${size} stateful-button-group ${className} ${isLoading ? 'is-loading' : ''}`.trim()}
      aria-label={currentState.ariaLabel}
      title={currentState.title}
      disabled={disabled || isLoading}
      {...dataAttributes}
    >
      <div
        className="stateful-button-icon-wrapper"
        style={{
          height: `${iconHeight}px`,
          width: `${iconHeight}px`,
        }}
      >
        <motion.div
          className="stateful-button-carousel"
          animate={{
            y: containerOffset,
          }}
          transition={{
            type: 'tween',
            ease: 'linear',
            duration,
          }}
        >
          {states.map((state) => (
            <div
              key={state.key}
              className="stateful-button-icon-item"
              style={{
                height: `${iconHeight}px`,
                width: `${iconHeight}px`,
              }}
            >
              <span className="icon">
                {state.icon}
              </span>
            </div>
          ))}
        </motion.div>
      </div>
    </button>
  );
};
