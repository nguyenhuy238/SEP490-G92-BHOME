import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { theme } from '../../theme/theme';
import InvoicesPage from './pages/InvoicesPage';
import AutomationPage from './AutomationPage';
import { DemoBillingConfigurationGuide } from './BillingConfigurationPage';

// These are the actual default route modules, not their explicitly exported live children.
vi.mock('../../services/config', () => ({ isMockMode: true, apiBaseUrl: '' }));
vi.mock('./useInvoiceApi', () => ({
  useInvoiceApi: () => {
    throw new Error('Demo must never instantiate the invoice API client');
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(path: string, page: React.ReactNode) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path.split('?')[0]} element={page} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

it('renders the task-first invoice demo instead of the generic ResourcePage and uses no API', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  mount('/invoices', <InvoicesPage />);
  expect(await screen.findByRole('heading', { name: 'Hóa đơn phòng' })).toBeInTheDocument();
  expect(screen.getByText(/Dữ liệu demo · Không phát hành/)).toBeInTheDocument();
  const table = screen.getByRole('table', { name: 'Danh sách hóa đơn demo' });
  expect(screen.getByRole('group', { name: 'Lọc nhanh trạng thái hóa đơn' })).toBeVisible();
  expect(screen.queryByText('Bản nháp cần kiểm tra')).not.toBeInTheDocument();
  expect(within(table).getByText('Phòng A101')).toBeInTheDocument();
  fireEvent.click(within(table).getAllByRole('button', { name: 'Xem chi tiết' })[0]);
  const drawer = await screen.findByLabelText('Chi tiết hóa đơn demo');
  expect(within(drawer).getByRole('button', { name: 'Phát hành hóa đơn' })).toBeDisabled();
  expect(within(drawer).getByRole('link', { name: 'Kiểm tra chỉ số' })).toHaveAttribute(
    'href',
    '/meters',
  );
  fireEvent.click(within(drawer).getByRole('button', { name: 'Tính lại bản nháp' }));
  expect(within(drawer).getByText(/Tính lại hóa đơn thật chỉ khả dụng/)).toBeInTheDocument();
  fireEvent.click(within(drawer).getByRole('button', { name: 'Đóng chi tiết hóa đơn demo' }));
  await waitFor(() => expect(screen.queryByLabelText('Chi tiết hóa đơn demo')).toBeNull());
  expect(fetchMock).not.toHaveBeenCalled();
});

it('filters invoice demos and locally simulates a reviewed Final without a backend mutation', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  mount('/invoices', <InvoicesPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Bản nháp' }));
  expect(screen.getByRole('button', { name: 'Bản nháp' })).toHaveAttribute('aria-pressed', 'true');
  const table = screen.getByRole('table', { name: 'Danh sách hóa đơn demo' });
  expect(within(table).queryByText('Phòng A103')).not.toBeInTheDocument();
  fireEvent.click(within(table).getAllByRole('button', { name: 'Xem chi tiết' })[1]);
  const drawer = await screen.findByLabelText('Chi tiết hóa đơn demo');
  expect(within(drawer).getByRole('button', { name: 'Phát hành hóa đơn' })).toBeEnabled();
  fireEvent.click(within(drawer).getByRole('button', { name: 'Phát hành hóa đơn' }));
  const dialog = screen.getByRole('dialog', { name: 'Xác nhận phát hành (mô phỏng)' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận mô phỏng' }));
  expect(await within(drawer).findByText('Tổng đã phát hành')).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('renders a usable automation timeline in mock mode instead of an API warning', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  mount('/billing-automation', <AutomationPage />);
  expect(
    await screen.findByRole('heading', { name: 'Cấu hình lịch & chạy thử hóa đơn' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Cấu hình lịch' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Chạy thử thủ công' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Giao nhiệm vụ khởi tạo' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Giao nhiệm vụ vận hành' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tạo hóa đơn nháp' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Kiểm tra và phát hành' })).toBeDisabled();
  expect(screen.getByText('Hóa đơn nháp')).toBeInTheDocument();
  expect(screen.getByText('Thiếu chỉ số nước')).toBeInTheDocument();
  expect(screen.queryByText(/Dự kiến 3\/11\/2026/)).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Lịch chạy và giám sát demo/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /Lịch chạy và giám sát demo/ }));
  expect(screen.getByRole('link', { name: 'Kiểm tra hóa đơn sẵn sàng' })).toHaveAttribute(
    'href',
    '/invoices?invoiceId=demo-invoice-102',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Sửa cấu hình demo' }));
  const dialog = screen.getByRole('dialog', { name: 'Cấu hình lịch hóa đơn (demo)' });
  fireEvent.change(within(dialog).getByLabelText('Ngày giao việc ghi số'), {
    target: { value: '5' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Áp dụng lịch mẫu' }));
  expect(await screen.findByText(/Dự kiến 5\/11\/2026/)).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not apply schedule edits when the demo config dialog is cancelled', async () => {
  mount('/billing-automation', <AutomationPage />);
  fireEvent.click(screen.getByRole('button', { name: /Lịch chạy và giám sát demo/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Sửa cấu hình demo' }));
  const dialog = screen.getByRole('dialog', { name: 'Cấu hình lịch hóa đơn (demo)' });
  fireEvent.change(within(dialog).getByLabelText('Ngày giao việc ghi số'), {
    target: { value: '12' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
  expect(screen.getByText(/Dự kiến 3\/11\/2026/)).toBeInTheDocument();
});

it('exposes the read-only pricing setup guide for the existing pricing demo wrapper', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  mount('/pricing', <DemoBillingConfigurationGuide />);
  expect(screen.getByText(/Giá minh họa · Thay đổi tại đây/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Xem lịch xử lý' })).toHaveAttribute(
    'href',
    '/billing-automation',
  );
  expect(screen.getByRole('link', { name: 'Xem hóa đơn nháp' })).toHaveAttribute(
    'href',
    '/invoices',
  );
  expect(fetchMock).not.toHaveBeenCalled();
});
