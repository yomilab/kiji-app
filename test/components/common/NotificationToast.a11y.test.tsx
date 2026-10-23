import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NotificationToast } from '@/components/common/NotificationToast';
import { findSeriousAxeViolations } from '../../helpers/axe';

afterEach(cleanup);

describe('NotificationToast accessibility', () => {
  it('is announced as a polite status by default', async () => {
    const { container } = render(<NotificationToast message="Imported 12 feeds." />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Imported 12 feeds.');
    expect(await findSeriousAxeViolations(container)).toEqual([]);
  });

  it('can be an alert for errors', () => {
    render(<NotificationToast message="Couldn’t import that file." role="alert" />);
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t import that file.');
  });
});
