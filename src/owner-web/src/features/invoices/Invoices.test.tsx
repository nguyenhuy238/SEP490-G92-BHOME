import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { theme } from '../../theme/theme';
import type { Invoice } from '../../../../../packages/client-core/src/invoices';
import { LiveInvoicesPage } from './pages/InvoicesPage';
import { BillingConfigurationPage } from './BillingConfigurationPage';

const mocks = vi.hoisted(() => ({
  api: {
    request: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    draft: vi.fn(),
    refresh: vi.fn(),
    finalize: vi.fn(),
    schedule: vi.fn(),
    policies: vi.fn(),
    saveSchedule: vi.fn(),
  },
}));
vi.mock('./useInvoiceApi', () => ({ useInvoiceApi: () => mocks.api }));
vi.mock('../payments/OwnerInvoicePaymentPanel', () => ({ OwnerInvoicePaymentPanel: () => null }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
const invoice: Invoice = {
  id: 'bill',
  roomId: 'room',
  locationId: 'location',
  roomNumber: 'P101',
  locationName: 'Synthetic',
  billingPeriod: '2026-10-01',
  status: 'Draft',
  version: 2,
  total: '3119250',
  missingInputs: [],
  scheduledFinalDate: '2026-11-01',
  dueDate: '2026-11-10',
  finalizedAt: null,
  representativeTenantUserId: 'tenant',
  lines: [
    {
      id: 'line',
      category: 'Electricity',
      chargeCode: 'ELECTRICITY',
      name: 'Điện tổng hợp',
      policyId: 'policy',
      policyVersion: 1,
      rateDate: '2026-10-01',
      rate: '3500',
      quantity: '25.5',
      occupiedDays: 31,
      periodDays: 31,
      amount: '89250',
      meterReadingId: 'reading',
      previousReading: '100',
      confirmedReading: '125.5',
    },
  ],
};
function mount(element: React.ReactNode) {
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>{element}</MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.request.mockResolvedValue([]);
  mocks.api.list.mockResolvedValue({ items: [invoice], page: 1, pageSize: 20, totalCount: 1 });
  mocks.api.get.mockResolvedValue(invoice);
  mocks.api.schedule.mockResolvedValue(undefined);
  mocks.api.policies.mockResolvedValue({ items: [], page: 1, totalCount: 0 });
});
afterEach(cleanup);
it('shows persisted charges and finalizes only after explicit review confirmation, blocking duplicate clicks', async () => {
  let resolve!: (value: Invoice) => void;
  mocks.api.finalize.mockImplementation(
    () =>
      new Promise<Invoice>((done) => {
        resolve = done;
      }),
  );
  mount(<LiveInvoicesPage />);
  fireEvent.click(await screen.findByText('Xem chi tiết'));
  await screen.findByText('Điện tổng hợp');
  expect(screen.getByText('100 → 125,5')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Phát hành hóa đơn'));
  expect(mocks.api.finalize).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog');
  const submit = within(dialog).getByText('Xác nhận phát hành');
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(mocks.api.finalize).toHaveBeenCalledTimes(1);
  expect(mocks.api.finalize).toHaveBeenCalledWith('bill', 2);
  mocks.api.get.mockResolvedValue({ ...invoice, status: 'Final', version: 3 });
  resolve({ ...invoice, status: 'Final', version: 3 });
  await screen.findByText('Đã phát hành — chi phí được giữ nguyên');
  expect(screen.queryByText('Phát hành hóa đơn')).toBeNull();
});
it('keeps incomplete drafts visible and disables finalization', async () => {
  mocks.api.get.mockResolvedValue({ ...invoice, missingInputs: ['confirmed_reading_Water'] });
  mount(<LiveInvoicesPage />);
  fireEvent.click(await screen.findByText('Xem chi tiết'));
  await screen.findByText(/Chỉ số nước hợp lệ đã xác nhận/);
  expect(screen.getByText('Phát hành hóa đơn')).toBeDisabled();
});
it('shows an empty list and a retryable failure without inventing financial values', async () => {
  mocks.api.list.mockRejectedValue({ status: 403 });
  mount(<LiveInvoicesPage />);
  await screen.findByText('Tài khoản không có quyền thực hiện thao tác này.');
  mocks.api.list.mockResolvedValue({ items: [], page: 1, pageSize: 20, totalCount: 0 });
  fireEvent.click(screen.getByText('Thử lại'));
  await screen.findByText('Chưa có hóa đơn.');
});
it('requires Owner to choose every billing rule when the location has no schedule', async () => {
  mocks.api.request.mockResolvedValue([{ id: 'location', label: 'Synthetic' }]);
  mount(<BillingConfigurationPage />);
  fireEvent.mouseDown(await screen.findByLabelText('Cơ sở cấu hình'));
  fireEvent.click(await screen.findByRole('option', { name: 'Synthetic' }));
  await screen.findByText('Chọn đầy đủ các quy tắc trước khi lập hóa đơn đầu tiên.');
  expect(screen.getByText('Lưu quy tắc hóa đơn')).toBeDisabled();
  expect(mocks.api.saveSchedule).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(
      screen.getByText('Chưa có biểu giá. Thêm giá thuê, điện và nước để lập hóa đơn.'),
    ).toBeInTheDocument(),
  );
});
