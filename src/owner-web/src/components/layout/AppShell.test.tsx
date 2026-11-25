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

it('keeps desktop navigation fully labeled without a collapse button, including an old saved preference', () => {
  localStorage.setItem('bhome.owner.sidebar-collapsed', 'true');
  render(shell());
  expect(
    screen.queryByRole('button', { name: 'Thu gọn thanh điều hướng' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Mở rộng thanh điều hướng' }),
  ).not.toBeInTheDocument();
  const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
  expect(within(nav).queryByRole('link', { name: /MySign|Ký số/ })).not.toBeInTheDocument();
  expect(within(nav).getByText('Cơ sở & Phòng')).toBeInTheDocument();
  expect(within(nav).getByRole('link', { name: 'Tổng quan' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  fireEvent.click(within(nav).getByRole('link', { name: 'Cơ sở' }));
  expect(screen.getByRole('heading', { name: '/locations' })).toBeInTheDocument();
  expect(within(nav).getByRole('link', { name: 'Cơ sở' })).toHaveAttribute('aria-current', 'page');
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
  expect(within(tabs).getAllByRole('tab')).toHaveLength(5);
  expect(within(tabs).getByRole('tab', { name: 'Chỉ số điện nước' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(within(tabs).getByRole('tab', { name: 'Lịch lập hóa đơn' })).toHaveAttribute(
    'href',
    '/billing-automation',
  );
  expect(within(tabs).getByRole('tab', { name: 'Điều chỉnh hóa đơn' })).toHaveAttribute(
    'href',
    '/invoice-adjustments',
  );
  expect(within(tabs).getByRole('tab', { name: 'Giá & biểu phí' })).toHaveAttribute(
    'href',
    '/pricing',
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
  expect(screen.getByRole('tab', { name: 'Chi phí & đầu tư' })).toHaveAttribute(
    'href',
    '/expenses',
  );
  expect(screen.getByRole('tab', { name: /^Kịch bản$/ })).toHaveAttribute('href', '/what-if');
});

it.each([
  ['/pricing', 'Lập hóa đơn', 'Giá & biểu phí'],
  ['/billing-automation', 'Lập hóa đơn', 'Lịch lập hóa đơn'],
  ['/invoice-adjustments', 'Lập hóa đơn', 'Điều chỉnh hóa đơn'],
  ['/expenses', 'Chi phí & báo cáo', 'Chi phí & đầu tư'],
  ['/what-if', 'Chi phí & báo cáo', 'Kịch bản'],
])('keeps %s discoverable under its workspace', (route, workspace, tab) => {
  render(shell(route));
  const sidebar = screen.getByRole('navigation', { name: 'Điều hướng chính' });
  expect(within(sidebar).getByRole('link', { name: workspace })).toHaveClass('Mui-selected');
  expect(screen.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('heading', { name: route })).toBeInTheDocument();
});
it.each([
  ['/pricing', /kiểm tra giá và ngày hiệu lực/, 'Theo dõi chỉ số điện nước', '/meters'],
  ['/meters', /Staff xác nhận số đo/, 'Xem hóa đơn', '/invoices'],
  ['/invoices', /rà soát bản nháp/, 'Kiểm tra chỉ số điện nước', '/meters'],
  ['/billing-automation', /lịch có hiệu lực/, 'Xem hóa đơn', '/invoices'],
  ['/invoice-adjustments', /kiểm tra bằng chứng/, 'Xem danh sách hóa đơn', '/invoices'],
  ['/payments', /xác minh hóa đơn trước khi phân bổ/, 'Theo dõi công nợ', '/debts'],
  ['/debts', /hóa đơn còn phải thu/, 'Đối soát giao dịch', '/payments'],
  ['/expenses', /khoản đầu tư và chi phí thực tế/, 'Xem báo cáo kinh doanh', '/reports'],
  ['/reports', /bấm Xem báo cáo để tải kết quả kinh doanh/, 'Thử kịch bản What-if', '/what-if'],
  ['/what-if', /giả định về giá, lấp đầy và chi phí/, 'Về báo cáo thực tế', '/reports'],
] as const)('guides the user through the real purpose of %s', (path, description, next, href) => {
  render(shell(path));
  const guidance = screen.getByRole('region', { name: 'Hướng dẫn sử dụng mục này' });
  expect(within(guidance).getByText(description)).toBeInTheDocument();
  expect(within(guidance).getByRole('link', { name: next })).toHaveAttribute('href', href);
  expect(
    within(screen.getByRole('main')).getByRole('link', { name: 'Tổng quan tài chính' }),
  ).toHaveAttribute('href', '/finance');
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
