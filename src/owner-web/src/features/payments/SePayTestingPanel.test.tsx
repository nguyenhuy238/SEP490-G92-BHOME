import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DebtInvoice } from '../../../../../packages/client-core/src/payments';
import { SePayTestingPanel } from './SePayTestingPanel';

const mocks = vi.hoisted(() => ({
  api: {
    request: vi.fn(),
    payment: vi.fn(),
    instructions: vi.fn(),
    sepayEvents: vi.fn(),
    transfer: vi.fn(),
    allocate: vi.fn(),
    register: vi.fn(),
  },
  copy: vi.fn(),
}));
vi.mock('./usePaymentApi', () => ({ usePaymentApi: () => mocks.api }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'synthetic-owner' } }),
}));
const invoice = {
  invoiceId: 'invoice',
  locationName: 'Cơ sở tổng hợp',
  roomNumber: 'T101',
  billingPeriod: '2026-11-01',
} as DebtInvoice;
vi.mock('./PaymentInvoicePicker', () => ({
  PaymentInvoicePicker: ({
    choose,
    unpaidOnly,
  }: {
    choose: (row: DebtInvoice) => void;
    unpaidOnly?: boolean;
  }) => (
    <button onClick={() => choose(invoice)}>
      {unpaidOnly ? 'Chọn hóa đơn còn nợ tổng hợp' : 'Sai bộ lọc'}
    </button>
  ),
}));
const state = {
  invoiceId: 'invoice',
  paymentStatus: 'Unpaid',
  payableAmount: '2500000',
  paidAmount: '1000000',
  outstandingAmount: '1500000',
  dueDate: '2026-11-20',
  overdueDays: 0,
  history: [],
  transferReference: 'BH12345678',
};
const transfer = {
  invoiceId: 'invoice',
  availability: 'Available',
  bankIdentifier: '970416',
  accountNumber: '0000001234',
  accountHolder: 'SYNTHETIC TEST',
  outstandingAmount: '1500000',
  transferReference: 'BH12345678',
  transferDescription: 'BH12345678',
  isDevelopmentDemo: true,
  qrImageDataUri: 'data:image/png;base64,synthetic',
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.request.mockResolvedValue({ mode: 'Test' });
  mocks.api.payment.mockResolvedValue(state);
  mocks.api.instructions.mockResolvedValue(transfer);
  mocks.api.sepayEvents.mockResolvedValue({ items: [], totalCount: 0 });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.copy.mockResolvedValue(undefined) },
  });
});
afterEach(cleanup);
function mount() {
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SePayTestingPanel />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
async function chooseInvoice() {
  fireEvent.click(await screen.findByRole('button', { name: 'Chọn hóa đơn kiểm thử' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chọn hóa đơn còn nợ tổng hợp' }));
}
it('uses registered server instructions and only links to the external simulator', async () => {
  mount();
  await chooseInvoice();
  const link = await screen.findByRole('link', { name: 'Mở trình mô phỏng SePay' });
  expect(link.getAttribute('href')).toBe('https://my.sepay.vn/testmode/transaction/simulate');
  expect(
    screen.getByText(
      /Tổng phải trả: 2.500.000 ₫ · Đã ghi nhận: 1.000.000 ₫ · Còn phải trả: 1.500.000 ₫/,
    ),
  ).toBeTruthy();
  expect(screen.getByText('QR thử nghiệm – Không chuyển tiền thật.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Sao chép nội dung' }));
  await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('BH12345678'));
  expect(mocks.api.allocate).not.toHaveBeenCalled();
  expect(mocks.api.register).not.toHaveBeenCalled();
  expect(mocks.api.request.mock.calls[0][0]).toBe('/api/v1/integrations/sepay/testing-context');
});
it('hides the workspace when the backend denies the testing context', async () => {
  mocks.api.request.mockRejectedValue(new Error('Synthetic denied'));
  mount();
  await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
  expect(screen.queryByText('Kiểm thử SePay')).toBeNull();
  expect(mocks.api.payment).not.toHaveBeenCalled();
});
it.each([
  { ...transfer, isDevelopmentDemo: false },
  { ...transfer, outstandingAmount: '2500000' },
  { ...transfer, transferReference: 'UNREGISTERED' },
])('never offers a simulator for unsafe or stale instructions: %j', async (instructions) => {
  mocks.api.instructions.mockResolvedValue(instructions);
  mount();
  await chooseInvoice();
  await screen.findByText(/Chưa có hướng dẫn Test Mode hợp lệ/);
  expect(screen.queryByRole('link', { name: 'Mở trình mô phỏng SePay' })).toBeNull();
  expect(screen.queryByAltText('QR thử nghiệm hóa đơn')).toBeNull();
});
it('updates to Paid only after a verified backend response, then removes the transfer action', async () => {
  mount();
  await chooseInvoice();
  await screen.findByRole('link', { name: 'Mở trình mô phỏng SePay' });
  mocks.api.payment.mockResolvedValue({
    ...state,
    paymentStatus: 'Paid',
    paidAmount: '2500000',
    outstandingAmount: '0',
  });
  mocks.api.instructions.mockResolvedValue({
    ...transfer,
    availability: 'Settled',
    outstandingAmount: '0',
    accountNumber: null,
    qrImageDataUri: null,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Làm mới hóa đơn kiểm thử' }));
  await screen.findByText('Đã thanh toán · Hạn 20/11/2026');
  expect(screen.queryByRole('link', { name: 'Mở trình mô phỏng SePay' })).toBeNull();
  expect(mocks.api.allocate).not.toHaveBeenCalled();
});
