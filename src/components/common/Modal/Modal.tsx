import React, { useEffect } from 'react';
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
}

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
}) => {
  const resolvedWidth = width === 'auto' ? 'fit-content' : width;

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
            className="modal-card"
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
              aria-label="Close modal"
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
