import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { isCloseOnEscapeShortcut, keybindingService } from '@/services/shortcuts/shortcutService';
import './DropdownMenu.css';

interface DropdownMenuProps {
  isOpen: boolean;
  children: React.ReactNode;
  menuRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
  align?: 'left' | 'right';
  onRequestClose?: () => void;
}

export const DropdownMenu: React.FC<DropdownMenuProps> = ({
  isOpen,
  children,
  menuRef,
  className = '',
  align = 'right',
  onRequestClose,
}) => {
  useEffect(() => {
    if (!isOpen || !onRequestClose) return;

    return keybindingService.register({
      type: 'keydown',
      capture: true,
      priority: 1000,
      handler: (event: KeyboardEvent) => {
        if (!isCloseOnEscapeShortcut(event)) return;

        event.preventDefault();
        event.stopPropagation();
        onRequestClose();
      },
    });
  }, [isOpen, onRequestClose]);

  if (!isOpen) return null;

  return (
    <motion.div
      ref={menuRef as React.Ref<HTMLDivElement>}
      className={`dropdown-menu dropdown-menu-align-${align} has-no-drag ${className}`.trim()}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.15 }}
    >
      {children}
    </motion.div>
  );
};
