import React from 'react';
import { DropdownMenu } from '@/components/common/DropdownMenu/DropdownMenu';

export interface SubmenuItem {
  label: string;
  onClick: () => void;
}

interface SubmenuDropdownProps {
  items: SubmenuItem[];
  isOpen: boolean;
  menuRef?: React.RefObject<HTMLDivElement | null>;
}

export const SubmenuDropdown: React.FC<SubmenuDropdownProps> = ({ items, isOpen, menuRef }) => {
  return (
    <DropdownMenu isOpen={isOpen} menuRef={menuRef}>
      {items.map((item, index) => (
        <button
          key={index}
          className="dropdown-menu-item"
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </DropdownMenu>
  );
};
