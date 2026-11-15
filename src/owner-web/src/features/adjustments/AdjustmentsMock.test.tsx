import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import AdjustmentsPage from './AdjustmentsPage';

vi.mock('../../services/config', () => ({ isMockMode: true }));

it('shows a compact demo empty state without implying financial approval is available', () => {
  render(
    <MemoryRouter initialEntries={['/invoice-adjustments']}>
      <AdjustmentsPage />
    </MemoryRouter>,
  );

  expect(
    screen.getByText(/Chưa có yêu cầu điều chỉnh thực tế trong chế độ demo/),
  ).toBeInTheDocument();
  expect(screen.queryByText('Quy trình xử lý yêu cầu điều chỉnh')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Xem danh sách hóa đơn demo' })).toHaveAttribute(
    'href',
    '/invoices',
  );
  expect(screen.queryByRole('button', { name: 'Phê duyệt điều chỉnh' })).not.toBeInTheDocument();
});
