import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OwnerTable } from './OwnerWorkspace';
it('prioritizes loading and failure over a misleading empty state and supports retry', () => {
  const retry = vi.fn();
  const props = { rows: [] as string[], columns: [], id: (row: string) => row };
  const view = render(<OwnerTable {...props} loading />);
  expect(screen.getByRole('status', { name: 'Đang tải dữ liệu' })).toBeInTheDocument();
  view.rerender(<OwnerTable {...props} error={new Error('Synthetic unavailable')} retry={retry} />);
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText('Không có dữ liệu phù hợp với bộ lọc.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(retry).toHaveBeenCalledOnce();
  view.rerender(<OwnerTable {...props} />);
  expect(screen.getByRole('status')).toHaveTextContent('Không có dữ liệu phù hợp');
});
