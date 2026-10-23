import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { isModalCloseShortcut, keybindingService } from '@/services/shortcuts/shortcutService';
import './Modal.css';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
  maxWidth?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  showBackdrop?: boolean;
  backdropOpacity?: number;
  /** id of the visible title, so VoiceOver names the dialog. */
  ariaLabelledBy?: string;
  ariaLabel?: string;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  children,
  width = '100%',
  maxWidth = '420px',
  closeOnBackdrop = true,
  closeOnEscape = true,
  showBackdrop = true,
  backdropOpacity = 0.2,
  ariaLabelledBy,
  ariaLabel,
}) => {
  const resolvedWidth = width === 'auto' ? 'fit-content' : width;
  const cardRef = useRef<HTMLDivElement>(null);

  // Give focus back to whatever opened the dialog (e.g. the sidebar + button).
  // Read during render: autoFocus inside the dialog moves focus before effects run.
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (isOpen && !wasOpenRef.current) {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpenRef.current = isOpen;
  useEffect(() => {
    if (!isOpen) return;
    return () => {
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [isOpen]);

  // Keep Tab inside the dialog while it is open.
  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !cardRef.current) return;
    const focusable = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleBackdropClick = () => {
    if (closeOnBackdrop) {
      onClose();
    }
  };

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    return keybindingService.register({
      type: 'keydown',
      capture: true,
      priority: 300,
      isEnabled: () => closeOnEscape,
      handler: (e: KeyboardEvent) => {
        if (!isModalCloseShortcut(e)) {
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      },
    });
  }, [isOpen, closeOnEscape, onClose]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-backdrop"
          onClick={handleBackdropClick}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            backgroundColor: showBackdrop ? `rgba(0, 0, 0, ${backdropOpacity})` : 'transparent',
          }}
        >
          <motion.div
            ref={cardRef}
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby={ariaLabelledBy}
            aria-label={ariaLabelledBy ? undefined : ariaLabel}
            onKeyDown={handleCardKeyDown}
            onClick={(e) => e.stopPropagation()}
            style={{ width: resolvedWidth, maxWidth }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <button
              className="modal-close"
              onClick={onClose}
              aria-label="Close"
              type="button"
            >
              <CloseRoundedIcon className="modal-close-icon" />
            </button>
            <section className="modal-body">{children}</section>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};
