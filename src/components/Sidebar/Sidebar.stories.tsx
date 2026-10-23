import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Sidebar } from './Sidebar';
import { SharedArticleList } from '@/components/MainArea/SharedArticleList';

const meta = {
  title: 'Theme Debug/Sidebar',
  component: Sidebar,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  parameters: {
    kiji: { variant: 'sidebar-default' },
  },
  render: () => (
    <div className="theme-debug-surface">
      <div className="theme-debug-sidebar-frame">
        <Sidebar />
      </div>
    </div>
  ),
};

export const Overflow: Story = {
  parameters: {
    kiji: { variant: 'sidebar-overflow' },
  },
  render: () => (
    <div className="theme-debug-surface" style={{ height: 'min(480px, 100%)' }}>
      <div className="theme-debug-sidebar-frame">
        <Sidebar />
      </div>
    </div>
  ),
};


export const TodaySelected: Story = {
  parameters: {
    kiji: { variant: 'sidebar-today' },
  },
  render: () => (
    <div className="theme-debug-surface" style={{ display: 'flex' }}>
      <div className="theme-debug-sidebar-frame">
        <Sidebar />
      </div>
      <div className="main-area theme-debug-list-frame">
        <SharedArticleList layout="3-column" variant="common" />
      </div>
    </div>
  ),
};

/**
 * Keyboard focus rings (screenshot state). Only one element can hold focus, so
 * the list row is truly focused and the sidebar row borrows the same ring
 * through a story-only attribute to show both in one capture.
 */
function ShowFocusRings() {
  useEffect(() => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const sidebarRow = document.querySelector<HTMLElement>('.smart-view-item.is-selected');
      const listRows = document.querySelectorAll<HTMLElement>('.article-list-item[role="option"]');
      if (sidebarRow && listRows.length > 1) {
        sidebarRow.setAttribute('data-story-focus-ring', '');
        (listRows[1].focus as (options?: { focusVisible?: boolean }) => void).call(listRows[1], { focusVisible: true });
        window.clearInterval(timer);
      } else if (attempts > 50) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <style>{`[data-story-focus-ring] { outline: 2px solid var(--focus-ring-color); outline-offset: -2px; }`}</style>
  );
}

export const FocusRings: Story = {
  parameters: {
    kiji: { variant: 'sidebar-today' },
  },
  render: (args, context) => (
    <>
      {TodaySelected.render!(args, context)}
      <ShowFocusRings />
    </>
  ),
};
