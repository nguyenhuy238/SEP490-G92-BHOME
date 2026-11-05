import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
    history: vi.fn(),
    transfers: vi.fn(),
    request: vi.fn(),
  },
}));
vi.mock('./usePaymentApi', () => ({ usePaymentApi: () => mocks.api }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
const id = '00000000-0000-0000-0000-000000000001';
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
    screen.getByText('Đã thanh toán đủ hóa đơn; tiền thừa giữ chờ Owner xử lý.'),
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
  mocks.api.transfers.mockResolvedValue({ items: [], totalCount: 0 });
  mocks.api.history.mockResolvedValue({ items: [], totalCount: 0 });
  mocks.api.invoices.mockResolvedValue({ items: [], totalCount: 0 });
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
  await screen.findByText(/Chưa thanh toán · Còn phải trả 100.000/);
  fireEvent.click(
    await screen.findByLabelText('Tôi xác nhận đúng hóa đơn và người thực trả theo bằng chứng'),
  );
  fireEvent.click(screen.getByText('Xác nhận phân bổ tiền'));
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Xác nhận đối soát'));
  await screen.findByText(/Đã thanh toán · Còn phải trả 0/);
  expect(mocks.api.history).toHaveBeenCalledTimes(2);
});
