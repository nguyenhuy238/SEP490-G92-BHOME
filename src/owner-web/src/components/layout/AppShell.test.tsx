import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { theme } from '../../theme/theme';
import { AppShell } from './AppShell';

const mocks = vi.hoisted(() => ({
  data: undefined as
    { records: { locations: { id: string; code: string; name: string }[] } } | undefined,
  isError: false,
  setLocationId: vi.fn(),
  setSearch: vi.fn(),
}));
vi.mock('../../services/config', () => ({ isMockMode: false, apiBaseUrl: '' }));
vi.mock('../../app/PortalProvider', () => ({
  usePortal: () => ({
    locationId: 'all',
    search: '',
    setLocationId: mocks.setLocationId,
    setSearch: mocks.setSearch,
  }),
}));
vi.mock('../../hooks/usePortalData', () => ({
  usePortalData: () => ({ data: mocks.data, isError: mocks.isError }),
  usePortalAction: () => ({ isPending: false }),
}));
vi.mock('../../features/notifications/NotificationBell', () => ({ NotificationBell: () => null }));

function CurrentPath() {
  const navigate = useNavigate();
  return (
    <>
      <h1>{useLocation().pathname}</h1>
      <button onClick={() => navigate('/reports')}>Mở báo cáo từ công việc khác</button>
    </>
  );
}
function shell(path = '/dashboard') {
  return (
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<CurrentPath />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.data = undefined;
  mocks.isError = false;
});

it('preserves named navigation and active state when collapsed, and restores the preference on remount', () => {
  const first = render(shell());
  const toggle = screen.getByRole('button', { name: 'Thu gọn thanh điều hướng' });
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(toggle);
  expect(screen.getByRole('button', { name: 'Mở rộng thanh điều hướng' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
  expect(within(nav).getByRole('link', { name: 'Tổng quan' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  fireEvent.click(within(nav).getByRole('link', { name: 'Cơ sở' }));
  expect(screen.getByRole('heading', { name: '/locations' })).toBeInTheDocument();
  expect(within(nav).getByRole('link', { name: 'Cơ sở' })).toHaveAttribute('aria-current', 'page');
  first.unmount();

  render(shell());
  fireEvent.click(screen.getByRole('button', { name: 'Mở rộng thanh điều hướng' }));
  expect(screen.getByRole('button', { name: 'Thu gọn thanh điều hướng' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});

it('shows four finance workspaces in the sidebar without repeating subpages', () => {
  render(shell('/finance'));
  const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
  expect(within(nav).getByRole('link', { name: 'Tổng quan tài chính' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(within(nav).getByRole('link', { name: 'Lập hóa đơn' })).toHaveAttribute(
    'href',
    '/invoices',
  );
  expect(within(nav).getByRole('link', { name: 'Thu tiền & công nợ' })).toHaveAttribute(
    'href',
    '/payments',
  );
  expect(within(nav).getByRole('link', { name: 'Chi phí & báo cáo' })).toHaveAttribute(
    'href',
    '/reports',
  );
  for (const name of [
    'Chỉ số điện nước',
    'Lịch tự động',
    'Điều chỉnh hóa đơn',
    'Công nợ',
    'Đầu tư & Chi phí',
  ]) {
    expect(within(nav).queryByRole('link', { name })).not.toBeInTheDocument();
  }
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  fireEvent.click(within(nav).getByRole('link', { name: 'Lập hóa đơn' }));
  expect(screen.getByRole('heading', { name: '/invoices' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Hóa đơn' })).toHaveAttribute('aria-selected', 'true');
});
it('keeps the invoice workspace selected on deep links and exposes all invoice tasks as tabs', () => {
  render(shell('/meters'));
  const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
  expect(within(nav).getByRole('link', { name: 'Lập hóa đơn' })).toHaveClass('Mui-selected');
  expect(within(nav).getByRole('link', { name: 'Lập hóa đơn' })).toHaveAttribute(
    'aria-description',
    'Nhóm đang mở',
  );
  const tabs = screen.getByRole('tablist', { name: 'Chọn mục trong lập hóa đơn' });
  expect(within(tabs).getAllByRole('tab')).toHaveLength(4);
  expect(within(tabs).getByRole('tab', { name: 'Chỉ số điện nước' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(within(tabs).getByRole('tab', { name: 'Lịch tự động' })).toHaveAttribute(
    'href',
    '/billing-automation',
  );
  expect(within(tabs).getByRole('tab', { name: 'Điều chỉnh' })).toHaveAttribute(
    'href',
    '/invoice-adjustments',
  );
  fireEvent.click(within(tabs).getByRole('tab', { name: 'Hóa đơn' }));
  expect(screen.getByRole('heading', { name: '/invoices' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Hóa đơn' })).toHaveAttribute('aria-selected', 'true');
});
it('switches the highlighted workspace and tabs when navigating between finance groups', () => {
  render(shell('/debts'));
  const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
  expect(within(nav).getByRole('link', { name: 'Thu tiền & công nợ' })).toHaveClass('Mui-selected');
  expect(screen.getByRole('tab', { name: 'Công nợ' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Mở báo cáo từ công việc khác' }));
  expect(screen.getByRole('heading', { name: '/reports' })).toBeInTheDocument();
  expect(within(nav).getByRole('link', { name: 'Chi phí & báo cáo' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(within(nav).getByRole('link', { name: 'Thu tiền & công nợ' })).not.toHaveClass(
    'Mui-selected',
  );
  expect(screen.getByRole('tab', { name: 'Báo cáo' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Đầu tư & chi phí' })).toHaveAttribute(
    'href',
    '/expenses',
  );
  expect(screen.getByRole('tab', { name: 'Dự báo What-if' })).toHaveAttribute('href', '/what-if');
});

it.each([
  ['/billing-automation', 'Lập hóa đơn', 'Lịch tự động'],
  ['/invoice-adjustments', 'Lập hóa đơn', 'Điều chỉnh'],
  ['/expenses', 'Chi phí & báo cáo', 'Đầu tư & chi phí'],
  ['/what-if', 'Chi phí & báo cáo', 'Dự báo What-if'],
])('keeps %s discoverable under its workspace', (route, workspace, tab) => {
  render(shell(route));
  const sidebar = screen.getByRole('navigation', { name: 'Điều hướng chính' });
  expect(within(sidebar).getByRole('link', { name: workspace })).toHaveClass('Mui-selected');
  expect(screen.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('heading', { name: route })).toBeInTheDocument();
});

it('keeps the location from the deep link during loading and switches to another location on the same section', () => {
  const { rerender } = render(shell('/locations/loc-1/rooms'));
  const selector = screen.getByRole('combobox', { name: 'Chọn cơ sở' });
  expect(selector).toHaveAttribute('aria-disabled', 'true');
  expect(selector).toHaveTextContent('Đang tải cơ sở');

  mocks.data = {
    records: {
      locations: [
        { id: 'loc-1', code: 'CS-01', name: 'Cơ sở thứ nhất' },
        { id: 'loc-2', code: 'CS-02', name: 'Cơ sở thứ hai' },
      ],
    },
  };
  rerender(shell('/locations/loc-1/rooms'));
  expect(selector).toHaveTextContent('Cơ sở thứ nhất');
  fireEvent.mouseDown(selector);
  fireEvent.click(screen.getByRole('option', { name: 'Cơ sở thứ hai' }));
  expect(mocks.setLocationId).toHaveBeenCalledWith('loc-2');
  expect(screen.getByRole('heading', { name: '/locations/loc-2/rooms' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Chọn cơ sở' })).toHaveTextContent('Cơ sở thứ hai');
});

it('does not show an unrelated selected location if the current location is missing from the list', () => {
  mocks.data = { records: { locations: [{ id: 'loc-2', code: 'CS-02', name: 'Cơ sở thứ hai' }] } };
  render(shell('/locations/loc-1/overview'));
  expect(screen.getByRole('combobox', { name: 'Chọn cơ sở' })).toHaveTextContent('Cơ sở hiện tại');
  expect(mocks.setLocationId).not.toHaveBeenCalled();
});

it('distinguishes a failed location list from a loading request without changing location context', () => {
  mocks.isError = true;
  render(shell('/locations/loc-1/overview'));
  const selector = screen.getByRole('combobox', { name: 'Chọn cơ sở' });
  expect(selector).toHaveAttribute('aria-disabled', 'true');
  expect(selector).toHaveTextContent('Không tải được danh sách cơ sở');
  expect(mocks.setLocationId).not.toHaveBeenCalled();
});
