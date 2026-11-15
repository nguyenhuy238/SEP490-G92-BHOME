import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter, useLocation } from 'react-router';
import { expect, it, vi } from 'vitest';
import { theme } from '../../../theme/theme';
import PaymentsPage from './PaymentsPage';

vi.mock('../../../services/config', () => ({ isMockMode: true }));
vi.mock('../../../app/PortalProvider', () => ({
  usePortal: () => ({ locationId: 'all' }),
}));
vi.mock('../../../hooks/usePortalData', () => ({
  usePortalData: () => ({
    isPending: false,
    isError: false,
    data: {
      records: {
        payments: [
          {
            id: 'pending-1',
            code: 'PAY-001',
            name: 'Chuyển khoản demo 1',
            status: 'Chờ đối soát',
            amount: 100000,
            date: '2026-11-10',
            locationId: 'loc-1',
          },
          {
            id: 'paid-2',
            code: 'PAY-002',
            name: 'Chuyển khoản demo 2',
            status: 'Đã đối soát',
            amount: 200000,
            date: '2026-11-11',
            locationId: 'loc-1',
          },
        ],
      },
    },
  }),
}));
vi.mock('../../../components/common/ResourcePage', () => ({
  ResourcePage: () => {
    const location = useLocation();
    return <div>Quản lý nâng cao {location.search}</div>;
  },
}));
vi.mock('../../finance/DemoFinanceTaskPanel', () => ({
  DemoFinanceTaskPanel: () => <div>Dữ liệu thanh toán demo</div>,
}));

it('opens the mock pending-transfer queue first and keeps full demo management available', () => {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/payments']}>
        <PaymentsPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
  const table = screen.getByRole('table', { name: 'Danh sách giao dịch thanh toán minh họa' });
  expect(within(table).getByText('PAY-001')).toBeInTheDocument();
  expect(within(table).queryByText('PAY-002')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tất cả' }));
  expect(within(table).getByText('PAY-002')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Quản lý dữ liệu demo' })).toBeInTheDocument();
  fireEvent.click(within(table).getAllByRole('button', { name: 'Xem giao dịch' })[0]);
  expect(screen.getByText('Quản lý nâng cao ?selected=pending-1')).toBeInTheDocument();
  expect(
    screen.queryByRole('table', { name: 'Danh sách giao dịch thanh toán minh họa' }),
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại danh sách đối soát' }));
  expect(
    screen.getByRole('table', { name: 'Danh sách giao dịch thanh toán minh họa' }),
  ).toBeInTheDocument();
});
