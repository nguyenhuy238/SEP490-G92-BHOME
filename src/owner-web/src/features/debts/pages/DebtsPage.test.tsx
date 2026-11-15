import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter, useLocation } from 'react-router';
import { expect, it, vi } from 'vitest';
import { theme } from '../../../theme/theme';
import DebtsPage from './DebtsPage';

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
        debts: [
          {
            id: 'debt-1',
            code: 'INV-01',
            name: 'Phòng P101',
            status: 'Quá hạn',
            amount: 120000,
            paid: 20000,
            date: '2026-11-10',
            locationId: 'loc-1',
          },
          {
            id: 'settled-2',
            code: 'INV-02',
            name: 'Phòng P102',
            status: 'Đã thanh toán',
            amount: 200000,
            paid: 200000,
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
    return <div>Quản lý công nợ đầy đủ {location.search}</div>;
  },
}));
vi.mock('../../../components/common/FeaturePanels', () => ({
  DebtAging: () => <div>Biểu đồ phân bổ tuổi nợ</div>,
}));

it('shows only outstanding demo debts by default and keeps full management and aging available on demand', () => {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/debts']}>
        <DebtsPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
  const table = screen.getByRole('table', { name: 'Danh sách công nợ minh họa' });
  expect(within(table).getByText('Phòng P101')).toBeInTheDocument();
  expect(within(table).queryByText('Phòng P102')).toBeNull();
  expect(within(table).getByText('100.000 ₫')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tất cả' }));
  expect(within(table).getByText('Phòng P102')).toBeInTheDocument();
  fireEvent.click(within(table).getAllByRole('button', { name: 'Xem công nợ' })[0]);
  expect(screen.getByText('Quản lý công nợ đầy đủ ?selected=debt-1')).toBeInTheDocument();
  expect(screen.queryByRole('table', { name: 'Danh sách công nợ minh họa' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Xem phân tích tuổi nợ' }));
  expect(screen.getByText('Biểu đồ phân bổ tuổi nợ')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Quay lại danh sách công nợ' }));
  expect(screen.getByRole('table', { name: 'Danh sách công nợ minh họa' })).toBeInTheDocument();
});
