import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import { DemoFinanceTaskPanel } from './DemoFinanceTaskPanel';

const mocks = vi.hoisted(() => ({
  locationId: 'loc-1',
  data: {
    records: {
      meters: [
        { locationId: 'loc-1', status: 'Chờ ghi chỉ số' },
        { locationId: 'loc-2', status: 'Chờ ghi chỉ số' },
      ],
      payments: [
        { locationId: 'loc-1', status: 'Chờ đối soát' },
        { locationId: 'loc-1', status: 'Đã đối soát' },
      ],
      debts: [
        { locationId: 'loc-1', amount: 1000, paid: 700 },
        { locationId: 'loc-1', amount: 500, paid: 500 },
      ],
    },
  },
}));

vi.mock('../../app/PortalProvider', () => ({
  usePortal: () => ({ locationId: mocks.locationId }),
}));
vi.mock('../../hooks/usePortalData', () => ({
  usePortalData: () => ({ data: mocks.data }),
}));

it.each([
  ['meters', 'Nhiệm vụ ghi chỉ số chưa hoàn tất', 'Lịch hóa đơn', '/billing-automation'],
  ['payments', 'Giao dịch chờ đối soát', 'Xem công nợ', '/debts'],
  ['debts', 'Khoản còn phải thu', 'Đối soát thanh toán', '/payments'],
] as const)('shows a compact scoped demo summary for %s', (kind, title, action, destination) => {
  render(
    <MemoryRouter>
      <DemoFinanceTaskPanel kind={kind} />
    </MemoryRouter>,
  );
  const summary = screen.getByRole('region', { name: 'Tóm tắt dữ liệu minh họa' });
  expect(summary).toHaveTextContent('1');
  expect(summary).toHaveTextContent(title);
  expect(summary).toHaveTextContent('dữ liệu demo');
  expect(screen.getByRole('link', { name: action })).toHaveAttribute('href', destination);
  expect(screen.queryByRole('link', { name: 'Xem toàn bộ chu trình' })).not.toBeInTheDocument();
});
