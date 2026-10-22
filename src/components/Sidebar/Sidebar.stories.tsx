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
