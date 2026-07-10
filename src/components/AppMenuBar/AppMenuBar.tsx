import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFeedNavigation } from '@/contexts/FeedContext';
import { useTheme } from '@/contexts/ThemeContext';
import { isCloseOnEscapeShortcut, keybindingService } from '@/services/shortcuts/shortcutService';
import {
  buildWindowsAppMenuTree,
  type AppMenuItem,
  type AppMenuTopLevel,
} from '@/services/ui/appMenuModel';
import { dispatchAppMenuAction } from '@/services/ui/dispatchAppMenuAction';
import { WindowCaptionButtons } from '@/components/WindowChrome/WindowCaptionButtons';
import './AppMenuBar.css';

function MenuItems({
  items,
  onAction,
  openSubmenuId,
  setOpenSubmenuId,
}: {
  items: AppMenuItem[];
  onAction: (item: Extract<AppMenuItem, { kind: 'item' }>) => void;
  openSubmenuId: string | null;
  setOpenSubmenuId: (id: string | null) => void;
}) {
  return (
    <ul className="app-menu-dropdown-list" role="menu">
      {items.map((item) => {
        if (item.kind === 'separator') {
          return <li key={item.id} className="app-menu-separator" role="separator" />;
        }

        if (item.kind === 'submenu') {
          const isOpen = openSubmenuId === item.id;
          return (
            <li
              key={item.id}
              className={`app-menu-submenu ${isOpen ? 'is-open' : ''}`}
              role="none"
              onMouseEnter={() => setOpenSubmenuId(item.id)}
            >
              <button
                type="button"
                className="app-menu-item app-menu-submenu-trigger"
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={isOpen}
                onClick={() => setOpenSubmenuId(isOpen ? null : item.id)}
              >
                <span>{item.label}</span>
                <span className="app-menu-submenu-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
              {isOpen && (
                <div className="app-menu-submenu-panel" role="menu">
                  <MenuItems
                    items={item.children}
                    onAction={onAction}
                    openSubmenuId={null}
                    setOpenSubmenuId={() => {}}
                  />
                </div>
              )}
            </li>
          );
        }

        return (
          <li key={item.id} role="none">
            <button
              type="button"
              className="app-menu-item"
              role="menuitem"
              aria-checked={item.checked}
              onClick={() => onAction(item)}
            >
              <span className="app-menu-item-check" aria-hidden="true">
                {item.checked ? '✓' : ''}
              </span>
              <span className="app-menu-item-label">{item.label}</span>
              {item.shortcutHint ? (
                <span className="app-menu-item-shortcut">{item.shortcutHint}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export const AppMenuBar: React.FC = () => {
  const { theme } = useTheme();
  const { selectedSmartView } = useFeedNavigation();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  const menuTree = useMemo<AppMenuTopLevel[]>(
    () =>
      buildWindowsAppMenuTree({
        theme,
        libraryView:
          selectedSmartView === 'saved'
          || selectedSmartView === 'unread'
          || selectedSmartView === 'all'
            ? selectedSmartView
            : null,
      }),
    [selectedSmartView, theme],
  );

  const closeMenus = useCallback(() => {
    setOpenMenuId(null);
    setOpenSubmenuId(null);
  }, []);

  const handleItemAction = useCallback(
    (item: Extract<AppMenuItem, { kind: 'item' }>) => {
      closeMenus();
      void dispatchAppMenuAction(item.action);
    },
    [closeMenus],
  );

  useEffect(() => {
    if (!openMenuId) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (barRef.current?.contains(target)) return;
      closeMenus();
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [closeMenus, openMenuId]);

  useEffect(() => {
    if (!openMenuId) return;

    return keybindingService.register({
      type: 'keydown',
      capture: true,
      priority: 1000,
      handler: (event: KeyboardEvent) => {
        if (!isCloseOnEscapeShortcut(event)) return;
        event.preventDefault();
        event.stopPropagation();
        closeMenus();
      },
    });
  }, [closeMenus, openMenuId]);

  useEffect(() => {
    return keybindingService.register({
      type: 'keydown',
      capture: true,
      priority: 20,
      handler: (event: KeyboardEvent) => {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
          return;
        }

        const key = event.key.toLowerCase();
        const match = menuTree.find((menu) => menu.accessKey === key);
        if (!match) return;

        event.preventDefault();
        event.stopPropagation();
        setOpenMenuId((current) => (current === match.id ? null : match.id));
        setOpenSubmenuId(null);
      },
    });
  }, [menuTree]);

  return (
    <div
      ref={barRef}
      className="app-menu-bar"
      data-component="app-menu-bar"
      role="menubar"
    >
      <div className="app-menu-bar-menus has-no-drag">
        {menuTree.map((menu) => {
          const isOpen = openMenuId === menu.id;
          return (
            <div key={menu.id} className={`app-menu-top ${isOpen ? 'is-open' : ''}`}>
              <button
                type="button"
                className="app-menu-top-button"
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={isOpen}
                onClick={() => {
                  setOpenMenuId(isOpen ? null : menu.id);
                  setOpenSubmenuId(null);
                }}
                onMouseEnter={() => {
                  if (openMenuId && openMenuId !== menu.id) {
                    setOpenMenuId(menu.id);
                    setOpenSubmenuId(null);
                  }
                }}
              >
                {menu.label}
              </button>
              {isOpen && (
                <div className="app-menu-dropdown has-no-drag" role="menu">
                  <MenuItems
                    items={menu.items}
                    onAction={handleItemAction}
                    openSubmenuId={openSubmenuId}
                    setOpenSubmenuId={setOpenSubmenuId}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="app-menu-bar-drag" data-tauri-drag-region />

      <WindowCaptionButtons />
    </div>
  );
};
