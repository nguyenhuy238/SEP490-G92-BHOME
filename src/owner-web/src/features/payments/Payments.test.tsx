import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { theme } from '../../theme/theme';
import {
  OwnerInvoicePaymentPanel,
  ReconcileTransfer,
  RecordTransferForm,
} from './OwnerInvoicePaymentPanel';
import { PaymentManagementPage } from './PaymentManagementPage';
const mocks = vi.hoisted(() => ({
  api: {
    payment: vi.fn(),
    instructions: vi.fn(),
    payers: vi.fn(),
    register: vi.fn(),
    allocate: vi.fn(),
    transfer: vi.fn(),
    reviews: vi.fn(),
    reject: vi.fn(),
    invoices: vi.fn(),
    debts: vi.fn(),
    debtSummary: vi.fn(),
    history: vi.fn(),
    transfers: vi.fn(),
    request: vi.fn(),
    excessDisposition: vi.fn(),
    excessContext: vi.fn(),
  },
}));
vi.mock('./usePaymentApi', () => ({ usePaymentApi: () => mocks.api }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
const id = '00000000-0000-0000-0000-000000000001';
it('pages verified payment history independently of the debt invoice page', async () => {
  mocks.api.history.mockResolvedValue({ items: [], totalCount: 41 });
  mocks.api.debts.mockResolvedValue({ items: [], totalCount: 0 });
  mount(<PaymentManagementPage debtOnly />);
  await screen.findByText('Trang lịch sử 1 · 41 thanh toán');
  fireEvent.click(screen.getByRole('button', { name: 'Lịch sử sau' }));
  await screen.findByText('Trang lịch sử 2 · 41 thanh toán');
  expect(mocks.api.history.mock.calls.at(-1)?.[0].page).toBe(2);
  expect(mocks.api.debts.mock.calls.at(-1)?.[0].page).toBe(1);
});
const transfer = {
  id: 'transfer',
  providerIdentity: 'SYNTHETIC',
  bankReference: 'SYN-001',
  amount: '100000',
  currency: 'VND',
  occurredAt: '2026-10-31T00:00:00Z',
  transferDescription: 'REFERENCE',
  statementReference: 'Synthetic statement',
  verificationReason: 'Owner checked',
  verifiedByUserId: 'owner',
  verifiedAt: '2026-11-01T00:00:00Z',
  proposedInvoiceId: id,
  status: 'PendingReview',
  reason: 'owner_allocation_confirmation_required',
  allocatedInvoiceId: null,
  isDevelopmentDemo: true,
};
const state = {
  invoiceId: id,
  paymentStatus: 'Unpaid' as const,
  payableAmount: '100000',
  paidAmount: '0',
  outstandingAmount: '100000',
  dueDate: '2026-11-01',
  overdueDays: 0,
  transferReference: 'REFERENCE',
  pendingReview: false,
  history: [],
};

it('shows backend allocation and surplus separately without offering another allocation', async () => {
  const excess = {
    ...transfer,
    status: 'Allocated',
    reason: 'verified_excess_payment_pending_review',
    allocatedAmount: '100000',
    unallocatedAmount: '20000',
  };
  mocks.api.transfer.mockResolvedValue(excess);
  mount(<ReconcileTransfer transfer={excess} />);
  expect(
    await screen.findByText('Đã phân bổ: 100.000 ₫ · Chưa phân bổ: 20.000 ₫'),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      'Đã phân bổ đủ hóa đơn từ giao dịch có tiền thừa. Xem trạng thái xử lý tại mục hoàn tiền.',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Xác nhận đối soát' })).not.toBeInTheDocument();
});
function mount(element: React.ReactNode) {
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        {element}
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.payment.mockResolvedValue(state);
  mocks.api.instructions.mockResolvedValue({ availability: 'ReceivingAccountUnavailable' });
  mocks.api.payers.mockResolvedValue([{ userId: 'tenant', displayLabel: 'Khách tổng hợp A' }]);
  mocks.api.transfer.mockResolvedValue(transfer);
  mocks.api.reviews.mockResolvedValue({ items: [], totalCount: 0 });
  mocks.api.request.mockResolvedValue([]);
  mocks.api.excessDisposition.mockResolvedValue(null);
  mocks.api.excessContext.mockResolvedValue({
    amount: '100000',
    outstanding: '100000',
    reference: 'test',
    transferReference: 'REFERENCE',
    payers: [],
    problems: ['receipt_target_not_settled'],
  });
  mocks.api.transfers.mockResolvedValue({ items: [], totalCount: 0 });
  mocks.api.history.mockResolvedValue({ items: [], totalCount: 0 });
  mocks.api.invoices.mockResolvedValue({ items: [], totalCount: 0 });
  mocks.api.debtSummary.mockResolvedValue({
    outstandingAmount: '0',
    overdueAmount: '0',
    invoiceCount: 0,
    overdueInvoiceCount: 0,
  });
});
afterEach(cleanup);
it('shows server-owned balance and explicit missing receiving configuration', async () => {
  mount(<OwnerInvoicePaymentPanel invoiceId={id} />);
  await screen.findByText(/Còn phải trả:/);
  expect(screen.getByText(/Chưa có tài khoản nhận tiền/)).toBeInTheDocument();
  expect(screen.queryByAltText('QR chuyển khoản hóa đơn')).toBeNull();
});
it('requires human allocation review and blocks duplicate confirmation clicks', async () => {
  let resolve!: (value: { status: string; reason: string }) => void;
  mocks.api.allocate.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  mount(<ReconcileTransfer transfer={transfer} />);
  const human = await screen.findByLabelText(
    'Tôi xác nhận đúng hóa đơn và người thực trả theo bằng chứng',
  );
  expect(screen.getByText('Xác nhận phân bổ tiền')).toBeDisabled();
  fireEvent.click(human);
  fireEvent.click(screen.getByText('Xác nhận phân bổ tiền'));
  expect(mocks.api.allocate).not.toHaveBeenCalled();
  const confirm = within(screen.getByRole('dialog')).getByText('Xác nhận đối soát');
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(mocks.api.allocate).toHaveBeenCalledTimes(1);
  expect(mocks.api.allocate.mock.calls[0].slice(0, 3)).toEqual(['transfer', id, null]);
  resolve({ status: 'PendingReview', reason: 'excess_payment_policy_required' });
  await screen.findByText('Tiền thừa: chờ xử lý, chưa tự phân bổ hoặc hoàn tiền.');
});
it('retains statement form input after failed registration instead of showing a false success', async () => {
  mocks.api.register.mockRejectedValue({ status: 409, code: 'bank_transaction_identity_conflict' });
  mount(<RecordTransferForm invoiceId={id} state={state} onClose={() => {}} />);
  for (const [label, value] of [
    ['Ngân hàng / nguồn sao kê', 'SYNTHETIC'],
    ['Mã giao dịch ngân hàng', 'SYN-001'],
    ['Thời gian giao dịch (giờ Việt Nam)', '2026-10-31T10:00'],
    ['Tham chiếu bằng chứng sao kê', 'SYNTHETIC-STATEMENT'],
    ['Căn cứ xác minh', 'Đã đối chiếu dữ liệu tổng hợp'],
  ])
    fireEvent.change(screen.getByLabelText(new RegExp(label.replace(/[()]/g, '\\$&'))), {
      target: { value },
    });
  fireEvent.click(screen.getByLabelText('Tôi đã đối chiếu sao kê và xác minh tiền thực nhận'));
  fireEvent.click(screen.getByText('Lưu giao dịch đã đối chiếu'));
  await screen.findByText('Tham chiếu ngân hàng đã tồn tại với dữ liệu khác.');
  expect(screen.getByLabelText(/Mã giao dịch ngân hàng/)).toHaveValue('SYN-001');
  expect(screen.queryByText('Đã lưu giao dịch. Chưa phân bổ vào hóa đơn.')).toBeNull();
});
it('retries an unavailable payment overview and renders the real empty state', async () => {
  mocks.api.invoices.mockRejectedValue({ status: 503 });
  mount(<PaymentManagementPage />);
  const retry = await screen.findByText('Thử lại');
  mocks.api.invoices.mockResolvedValue({ items: [], totalCount: 0 });
  fireEvent.click(retry);
  await screen.findByText('Không có hóa đơn phù hợp bộ lọc.');
});
it('refreshes invoice balance and history after successful allocation', async () => {
  const invoice = {
    invoiceId: id,
    locationName: 'Cơ sở tổng hợp',
    roomNumber: 'PAY-TEST',
    billingPeriod: '2026-10-01',
    dueDate: '2026-11-30',
    outstandingAmount: '100000',
    paymentStatus: 'Unpaid',
    overdueDays: 0,
  };
  mocks.api.invoices.mockResolvedValueOnce({ items: [invoice], totalCount: 1 }).mockResolvedValue({
    items: [{ ...invoice, outstandingAmount: '0', paymentStatus: 'Paid' }],
    totalCount: 1,
  });
  mocks.api.transfers.mockResolvedValue({ items: [transfer], totalCount: 1 });
  mocks.api.allocate.mockResolvedValue({ status: 'Allocated', reason: 'verified_full_payment' });
  mount(<PaymentManagementPage />);
  await screen.findByText(/Cơ sở tổng hợp · PAY-TEST/);
  await screen.findByRole('cell', { name: /^100\.000\s₫$/ });
  fireEvent.click(screen.getByRole('tab', { name: 'Lịch sử đã xác minh' }));
  await screen.findByText('Trang lịch sử 1 · 0 thanh toán');
  fireEvent.click(screen.getByRole('tab', { name: 'Đối soát giao dịch' }));
  fireEvent.click(
    await screen.findByLabelText('Tôi xác nhận đúng hóa đơn và người thực trả theo bằng chứng'),
  );
  fireEvent.click(screen.getByText('Xác nhận phân bổ tiền'));
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Xác nhận đối soát'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('tab', { name: 'Hóa đơn và số dư' }));
  await screen.findByRole('cell', { name: /^0\s₫$/ });
  fireEvent.click(screen.getByRole('tab', { name: 'Lịch sử đã xác minh' }));
  await screen.findByText('Trang lịch sử 1 · 0 thanh toán');
  expect(mocks.api.history).toHaveBeenCalledTimes(2);
});
it('shows the server aggregate independently of the visible invoice page and keeps debt separate from reconciliation', async () => {
  mocks.api.debts.mockResolvedValue({ items: [], totalCount: 100 });
  mocks.api.debtSummary.mockResolvedValue({
    outstandingAmount: '999999999999999999',
    overdueAmount: '100000',
    invoiceCount: 100,
    overdueInvoiceCount: 2,
  });
  mount(<PaymentManagementPage debtOnly />);
  expect(await screen.findByText('999.999.999.999.999.999 ₫')).toBeInTheDocument();
  expect(screen.getByText('Tổng dư nợ trong bộ lọc')).toBeInTheDocument();
  expect(mocks.api.transfers).not.toHaveBeenCalled();
  expect(screen.queryByRole('tab', { name: 'Tài khoản nhận tiền' })).not.toBeInTheDocument();
});
it('does not replace a failed debt aggregate with zero and permits retry', async () => {
  mocks.api.debts.mockResolvedValue({ items: [], totalCount: 0 });
  mocks.api.debtSummary.mockRejectedValueOnce({ status: 503 });
  mount(<PaymentManagementPage debtOnly />);
  fireEvent.click(await screen.findByRole('button', { name: 'Thử lại tổng hợp' }));
  expect(await screen.findByText('Tổng dư nợ trong bộ lọc')).toBeInTheDocument();
});
it('chooses a readable unpaid invoice for an unmatched transfer without entering its UUID', async () => {
  mocks.api.transfer.mockResolvedValue({ ...transfer, proposedInvoiceId: null });
  mocks.api.invoices.mockResolvedValue({
    items: [
      {
        invoiceId: id,
        locationName: 'Cơ sở chọn',
        roomNumber: 'P102',
        billingPeriod: '2026-11-01',
        dueDate: '2026-12-01',
        outstandingAmount: '100000',
      },
    ],
    totalCount: 1,
  });
  mount(<ReconcileTransfer transfer={{ ...transfer, proposedInvoiceId: null }} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Chọn hóa đơn cần phân bổ' }));
  const dialog = screen.getByRole('dialog', { name: 'Chọn hóa đơn cần phân bổ' });
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Chọn hóa đơn' }));
  expect(screen.getByText('Cơ sở chọn · Phòng P102 · 2026-11')).toBeInTheDocument();
  expect(screen.queryByLabelText('Mã hóa đơn cần phân bổ')).not.toBeInTheDocument();
  expect(mocks.api.invoices).toHaveBeenCalledWith(
    expect.objectContaining({ paymentStatus: 'Unpaid' }),
    expect.any(AbortSignal),
  );
  await waitFor(() => expect(mocks.api.payers).toHaveBeenCalledWith(id, expect.any(AbortSignal)));
});
