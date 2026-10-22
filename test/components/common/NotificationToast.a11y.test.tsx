import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NotificationToast } from '@/components/common/NotificationToast';
import { findSeriousAxeViolations } from '../../helpers/axe';

afterEach(cleanup);

describe('NotificationToast accessibility', () => {
  it('is a polite status whose Undo button is a reachable, named button', async () => {
    const onAction = vi.fn();
    const { container } = render(
      <NotificationToast message="Marked 12 articles as read" actionLabel="Undo" onAction={onAction} />,
    );
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Marked 12 articles as read');
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(status.contains(undo)).toBe(true);
    expect(undo.tabIndex).toBe(0);
    undo.focus();
    expect(document.activeElement).toBe(undo);
    fireEvent.click(undo);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(await findSeriousAxeViolations(container)).toEqual([]);
  });
});
