import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import {
  paymentClient,
  paymentError,
  type BankTransfer,
} from '../../../../../packages/client-core/src/payments';
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
    registerWithEvidence: vi.fn(),
    transferEvidence: vi.fn(),
    allocate: vi.fn(),
    transfer: vi.fn(),
    reviews: vi.fn(),
    reject: vi.fn(),
    invoices: vi.fn(),
    debts: vi.fn(),
    debtSummary: vi.fn(),
    history: vi.fn(),
    transfers: vi.fn(),
    account: vi.fn(),
    saveAccount: vi.fn(),
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
  fireEvent.click(screen.getByRole('button', { name: 'Xem lịch sử thu tiền' }));
  await screen.findByText('Trang lịch sử 1 · 41 thanh toán');
  fireEvent.click(screen.getByRole('button', { name: 'Lịch sử sau' }));
  await screen.findByText('Trang lịch sử 2 · 41 thanh toán');
  expect(mocks.api.history.mock.calls.at(-1)?.[0].page).toBe(2);
  expect(mocks.api.debts.mock.calls.at(-1)?.[0].page).toBe(1);
});
it('returns to page one of bank transfers when changing the visible billing period', async () => {
  mocks.api.transfers.mockResolvedValue({ items: [], totalCount: 41 });
  mount(<PaymentManagementPage />);
  fireEvent.click(screen.getByRole('tab', { name: 'Đối soát giao dịch' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Giao dịch sau' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Giao dịch sau' }));
  await waitFor(() => expect(mocks.api.transfers.mock.calls.at(-1)?.[0].page).toBe(2));
  fireEvent.change(screen.getByLabelText('Kỳ hóa đơn cần lọc'), { target: { value: '2026-11' } });
  await waitFor(() =>
    expect(mocks.api.transfers.mock.calls.at(-1)?.[0]).toMatchObject({
      page: 1,
      billingPeriod: '2026-11-01',
    }),
  );
  expect(mocks.api.allocate).not.toHaveBeenCalled();
  expect(mocks.api.register).not.toHaveBeenCalled();
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
it('shows a clear review queue and switches between pending and all transfers on page one', async () => {
  mocks.api.transfers.mockResolvedValue({ items: [transfer], totalCount: 41 });
  mount(<PaymentManagementPage />);
  await screen.findByRole('list', { name: 'Danh sách giao dịch đối soát' });
  expect(screen.getByRole('button', { name: /Chờ đối soát/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByText('Hiển thị 1–1 / 41 giao dịch')).toBeInTheDocument();
  expect(screen.getByText('100.000 ₫')).toBeInTheDocument();
  expect(screen.getByText(/Dữ liệu thử nghiệm/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Giao dịch sau' }));
  await waitFor(() => expect(mocks.api.transfers.mock.calls.at(-1)?.[0].page).toBe(2));
  fireEvent.click(screen.getByRole('button', { name: /Tất cả giao dịch/ }));
  await waitFor(() =>
    expect(mocks.api.transfers.mock.calls.at(-1)?.[0]).toMatchObject({
      page: 1,
      paymentStatus: '',
    }),
  );
  expect(screen.getByRole('button', { name: /Tất cả giao dịch/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(mocks.api.allocate).not.toHaveBeenCalled();
});
it('offers manual bank-statement entry only on the reconciliation tab, outside utilities', async () => {
  mount(<PaymentManagementPage />);
  const manualAction = await screen.findByRole('button', { name: 'Ghi nhận giao dịch thủ công' });
  fireEvent.click(screen.getByRole('button', { name: 'Tiện ích' }));
  expect(
    within(screen.getByRole('menu')).queryByText('Ghi nhận giao dịch thủ công'),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  fireEvent.click(manualAction);

  const dialog = await screen.findByRole('dialog', { name: 'Ghi nhận giao dịch thủ công' });
  expect(
    within(dialog).getByText(/Chỉ sử dụng khi đã đối chiếu tiền nhận trên sao kê/),
  ).toBeInTheDocument();
  expect(within(dialog).getByLabelText(/Mã giao dịch ngân hàng/)).toBeInTheDocument();
  expect(mocks.api.register).not.toHaveBeenCalled();
  expect(mocks.api.allocate).not.toHaveBeenCalled();

  fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy nhập' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Ghi nhận giao dịch thủ công' }),
    ).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Hóa đơn và số dư' }));
  expect(
    screen.queryByRole('button', { name: 'Ghi nhận giao dịch thủ công' }),
  ).not.toBeInTheDocument();
});
it('keeps a long bank reference readable and lets Owner reveal and copy the exact value', async () => {
  const reference = 'SP:ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789';
  const writeText = vi.fn().mockResolvedValue(undefined);
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  try {
    mocks.api.transfers.mockResolvedValue({
      items: [{ ...transfer, bankReference: reference }],
      totalCount: 1,
    });
    mount(<PaymentManagementPage />);
    await screen.findByRole('list', { name: 'Danh sách giao dịch đối soát' });
    expect(screen.queryByText(reference)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xem mã đầy đủ' }));
    expect(screen.getByText(reference)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép mã giao dịch' }));
    expect(await screen.findByText('Đã sao chép')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(reference);
  } finally {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});
it('opens reconciliation in a right drawer without expanding the row, then returns to the same queue', async () => {
  const secondTransfer = {
    ...transfer,
    id: 'transfer-two',
    bankReference: 'SYN-002',
    amount: '200000',
  };
  mocks.api.transfers.mockResolvedValue({ items: [transfer, secondTransfer], totalCount: 2 });
  mocks.api.transfer.mockImplementation(async (transferId: string) =>
    transferId === secondTransfer.id ? secondTransfer : transfer,
  );
  mount(<PaymentManagementPage />);

  const queue = await screen.findByRole('list', { name: 'Danh sách giao dịch đối soát' });
  const actions = within(queue).getAllByRole('button', { name: 'Kiểm tra & đối soát' });
  expect(actions).toHaveLength(2);
  fireEvent.click(actions[1]!);
  const drawer = await screen.findByRole('dialog', { name: 'Chi tiết đối soát giao dịch' });
  expect(within(drawer).getByText('SYN-002')).toBeInTheDocument();
  expect(within(drawer).getByText('200.000 ₫')).toBeInTheDocument();
  expect(within(drawer).getByText('Xác minh và phân bổ giao dịch')).toBeInTheDocument();
  expect(drawer).toHaveTextContent('Đóng để quay lại danh sách và bộ lọc hiện tại.');
  expect(document.querySelectorAll('[role="listitem"]')).toHaveLength(2);

  fireEvent.click(within(drawer).getByRole('button', { name: 'Đóng chi tiết giao dịch' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Chi tiết đối soát giao dịch' }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('list', { name: 'Danh sách giao dịch đối soát' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Chờ đối soát/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(mocks.api.allocate).not.toHaveBeenCalled();
});
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

it.each(['Unpaid', 'Paid', 'NotIssued'] as const)(
  'keeps bank-statement registration out of invoice details when status is %s',
  async (paymentStatus) => {
    mocks.api.payment.mockResolvedValue({
      ...state,
      paymentStatus,
      paidAmount: paymentStatus === 'Paid' ? '100000' : '0',
      outstandingAmount: paymentStatus === 'Paid' ? '0' : '100000',
    });
    mount(<OwnerInvoicePaymentPanel invoiceId={id} />);
    await screen.findByText('Còn phải trả:');
    expect(
      screen.queryByRole('button', { name: 'Ghi nhận giao dịch từ sao kê' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Đối chiếu sao kê ngân hàng')).not.toBeInTheDocument();
    expect(mocks.api.register).not.toHaveBeenCalled();
  },
);

it('identifies provider verification without claiming an Owner manually verified the statement', async () => {
  mocks.api.payment.mockResolvedValue({
    ...state,
    history: [
      {
        id: 'payment',
        amount: '100000',
        paidAt: '2026-11-12T05:00:00Z',
        paidBy: 'Synthetic unrelated tenant - should not appear',
        verificationSource: 'SePayTest',
        verifiedAt: '2026-11-12T05:00:00Z',
      },
    ],
  });
  mount(<OwnerInvoicePaymentPanel invoiceId={id} />);
  const historyToggle = await screen.findByRole('button', { name: 'Xem chi tiết hóa đơn' });
  expect(historyToggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(historyToggle);
  expect(screen.getByRole('button', { name: 'Ẩn chi tiết hóa đơn' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(await screen.findByText(/SePay thử nghiệm xác minh/)).toBeTruthy();
  expect(screen.queryByText(/Owner xác minh sao kê/)).toBeNull();
  expect(screen.queryByText(/Người trả:/)).not.toBeInTheDocument();
  expect(
    screen.queryByText('Synthetic unrelated tenant - should not appear'),
  ).not.toBeInTheDocument();
});

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
function mount(element: React.ReactNode, route = '/payments') {
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[route]}>{element}</MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:synthetic-bank-statement'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.mocked(window.matchMedia).mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  mocks.api.payment.mockResolvedValue(state);
  mocks.api.instructions.mockResolvedValue({ availability: 'ReceivingAccountUnavailable' });
  mocks.api.payers.mockResolvedValue([{ userId: 'tenant', displayLabel: 'Khách tổng hợp A' }]);
  mocks.api.transfer.mockResolvedValue(transfer);
  mocks.api.transferEvidence.mockResolvedValue(
    new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }),
  );
  mocks.api.reviews.mockResolvedValue({ items: [], totalCount: 0 });
  mocks.api.request.mockResolvedValue([]);
  mocks.api.account.mockResolvedValue(null);
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
it('loads the receipt selected by an authorized refund notification without allocating it automatically', async () => {
  mocks.api.transfer.mockResolvedValue({ ...transfer, id });
  mount(<PaymentManagementPage />, '/payments?transferId=' + id);
  expect(await screen.findByText('Giao dịch được liên kết')).toBeInTheDocument();
  await waitFor(() => expect(mocks.api.transfer).toHaveBeenCalledWith(id, expect.any(AbortSignal)));
  expect(mocks.api.allocate).not.toHaveBeenCalled();
});
it('rejects malformed receipt links before loading a finance record', async () => {
  mount(<PaymentManagementPage />, '/payments?transferId=..%2Fprivate');
  expect(await screen.findByText('Liên kết giao dịch không hợp lệ.')).toBeInTheDocument();
  expect(mocks.api.transfer).not.toHaveBeenCalled();
});
it('shows server-owned balance and explicit missing receiving configuration', async () => {
  mount(<OwnerInvoicePaymentPanel invoiceId={id} />);
  await screen.findByText(/Còn phải trả:/);
  expect(screen.getByText(/Chưa có tài khoản nhận tiền/)).toBeInTheDocument();
  expect(screen.queryByAltText('QR chuyển khoản hóa đơn')).toBeNull();
});
it('does not present an old invoice reference as a SePay payment memo or expose a non-BH QR', async () => {
  mocks.api.payment.mockResolvedValue({ ...state, transferReference: '314PSNOORMLSE8XT9DPF32NLU' });
  mocks.api.instructions.mockResolvedValue({
    availability: 'Available',
    bankIdentifier: '970422',
    accountNumber: '0000000001',
    accountHolder: 'DEMO OWNER',
    transferReference: '314PSNOORMLSE8XT9DPF32NLU',
    transferDescription: '314PSNOORMLSE8XT9DPF32NLU',
    qrImageDataUri: 'data:image/png;base64,TEST',
    isDevelopmentDemo: true,
  });
  mount(<OwnerInvoicePaymentPanel invoiceId={id} />);
  expect(await screen.findByText(/Chưa có mã BH hợp lệ/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Xem chi tiết hóa đơn' })).not.toBeInTheDocument();
  expect(screen.queryByText('314PSNOORMLSE8XT9DPF32NLU')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xem thông tin nhận chuyển khoản' }));
  expect(screen.queryByAltText('QR chuyển khoản hóa đơn')).not.toBeInTheDocument();
  expect(screen.getByText(/QR hiện tại không chứa mã BH đã đăng ký/)).toBeInTheDocument();
});
it('displays the registered BH memo when SePay transfer instructions are available', async () => {
  mocks.api.payment.mockResolvedValue({ ...state, transferReference: '314PSNOORMLSE8XT9DPF32NLU' });
  mocks.api.instructions.mockResolvedValue({
    availability: 'Available',
    bankIdentifier: '970422',
    accountNumber: '0000000001',
    accountHolder: 'DEMO OWNER',
    transferReference: 'BH12345678',
    transferDescription: 'BH12345678',
    qrImageDataUri: 'data:image/png;base64,TEST',
    isDevelopmentDemo: true,
  });
  mount(<OwnerInvoicePaymentPanel invoiceId={id} />);
  const detail = await screen.findByRole('button', { name: 'Xem chi tiết hóa đơn' });
  fireEvent.click(detail);
  expect(screen.getByText('BH12345678')).toBeInTheDocument();
  expect(screen.queryByText('314PSNOORMLSE8XT9DPF32NLU')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xem thông tin nhận chuyển khoản' }));
  expect(screen.getByAltText('QR chuyển khoản hóa đơn')).toBeInTheDocument();
});
it('opens bank instructions only on request and marks demo receiving details clearly', async () => {
  mocks.api.instructions.mockResolvedValue({
    availability: 'Available',
    bankIdentifier: '970418',
    accountNumber: '000111222',
    accountHolder: 'DEMO OWNER',
    isDevelopmentDemo: true,
  });
  mount(<OwnerInvoicePaymentPanel invoiceId={id} />);
  const toggle = await screen.findByRole('button', { name: 'Xem thông tin nhận chuyển khoản' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(screen.getByRole('button', { name: 'Ẩn thông tin nhận chuyển khoản' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(screen.getByText('DEMO OWNER')).toBeInTheDocument();
  expect(screen.getByText('Tài khoản tổng hợp demo. Không chuyển tiền thật.')).toBeInTheDocument();
  expect(mocks.api.register).not.toHaveBeenCalled();
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
  const human = await screen.findByLabelText('Tôi đã đối chiếu giao dịch và hóa đơn theo sao kê');
  expect(screen.queryByText('Trường hợp cần xử lý bổ sung')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Xác minh người trả bên ngoài' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Kiểm tra trường hợp phải hoàn toàn bộ tiền' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Người chuyển khoản:/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Có bằng chứng xác định người chuyển?' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Người.*trả|Người.*chuyển/i)).not.toBeInTheDocument();
  expect(mocks.api.payers).not.toHaveBeenCalled();
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
it('never calls the eligible-payer lookup or uses a suggested payer for invoice allocations', async () => {
  mocks.api.payers.mockRejectedValue({ status: 503 });
  mount(<ReconcileTransfer transfer={transfer} />);
  expect(screen.queryByText(/Không tải được danh sách khách thuê/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('combobox', { name: /người trả|người chuyển/i }),
  ).not.toBeInTheDocument();
  expect(mocks.api.payers).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Tôi đã đối chiếu giao dịch và hóa đơn theo sao kê'));
  expect(screen.getByRole('button', { name: 'Xác nhận phân bổ tiền' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận phân bổ tiền' }));
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Xác nhận đối soát' }),
  );
  await waitFor(() =>
    expect(mocks.api.allocate).toHaveBeenCalledWith('transfer', id, null, expect.any(String)),
  );
  expect(mocks.api.payers).not.toHaveBeenCalled();
});
it('retains statement form input after failed registration instead of showing a false success', async () => {
  mocks.api.registerWithEvidence.mockRejectedValue({
    status: 409,
    code: 'bank_transaction_identity_conflict',
  });
  mount(<RecordTransferForm invoiceId={id} state={state} onClose={() => {}} />);
  for (const [label, value] of [
    ['Ngân hàng / nguồn sao kê', 'SYNTHETIC'],
    ['Mã giao dịch ngân hàng', 'SYN-001'],
    ['Thời gian giao dịch (giờ Việt Nam)', '2026-10-31T10:00'],
  ])
    fireEvent.change(screen.getByLabelText(new RegExp(label.replace(/[()]/g, '\\$&'))), {
      target: { value },
    });
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục: kiểm tra bằng chứng & xác nhận' }));
  const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'synthetic.png', {
    type: 'image/png',
  });
  fireEvent.change(screen.getByLabelText('Chọn ảnh sao kê PNG hoặc JPEG'), {
    target: { files: [file] },
  });
  fireEvent.change(screen.getByLabelText(/Ghi chú xác minh/), {
    target: { value: 'Đã đối chiếu dữ liệu tổng hợp' },
  });
  fireEvent.click(screen.getByLabelText('Tôi đã đối chiếu sao kê và xác minh tiền thực nhận'));
  fireEvent.click(screen.getByText('Lưu giao dịch chờ đối soát'));
  await screen.findByText('Tham chiếu ngân hàng đã tồn tại với dữ liệu khác.');
  expect(screen.getByLabelText(/Mã giao dịch ngân hàng/)).toHaveValue('SYN-001');
  expect(screen.getByText(/Ảnh đã chọn: synthetic.png/)).toBeInTheDocument();
  expect(mocks.api.registerWithEvidence).toHaveBeenCalledWith(
    expect.objectContaining({
      statementReference: '',
      verificationReason: 'Đã đối chiếu dữ liệu tổng hợp',
      proposedInvoiceId: id,
      isDevelopmentDemo: false,
      humanVerified: true,
    }),
    file,
    expect.any(String),
  );
  const previousKey = mocks.api.registerWithEvidence.mock.calls[0][2];
  fireEvent.click(screen.getByText('Lưu giao dịch chờ đối soát'));
  await waitFor(() => expect(mocks.api.registerWithEvidence).toHaveBeenCalledTimes(2));
  expect(mocks.api.registerWithEvidence.mock.calls[1][2]).toBe(previousKey);
  expect(mocks.api.register).not.toHaveBeenCalled();
  expect(screen.queryByText('Đã lưu giao dịch. Chưa phân bổ vào hóa đơn.')).toBeNull();
});
it('uploads once while busy and keeps the saved transfer pending separate reconciliation', async () => {
  let complete!: (value: BankTransfer) => void;
  mocks.api.registerWithEvidence.mockImplementation(
    () =>
      new Promise<BankTransfer>((resolve) => {
        complete = resolve;
      }),
  );
  mount(<RecordTransferForm invoiceId="" onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText(/Ngân hàng \/ nguồn sao kê/), {
    target: { value: 'SYNTHETIC' },
  });
  fireEvent.change(screen.getByLabelText(/Mã giao dịch ngân hàng/), {
    target: { value: 'SYN-NEW-001' },
  });
  fireEvent.change(screen.getByLabelText(/Số tiền thực nhận VND/), {
    target: { value: '100000' },
  });
  fireEvent.change(screen.getByLabelText(/Thời gian giao dịch/), {
    target: { value: '2026-10-31T10:00' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục: kiểm tra bằng chứng & xác nhận' }));
  fireEvent.change(screen.getByLabelText('Chọn ảnh sao kê PNG hoặc JPEG'), {
    target: { files: [new File(['synthetic'], 'demo.jpg', { type: 'image/jpeg' })] },
  });
  fireEvent.change(screen.getByLabelText(/Ghi chú xác minh/), {
    target: { value: 'Synthetic transaction reviewed' },
  });
  fireEvent.click(
    screen.getByLabelText('Dữ liệu tổng hợp Development/Testing (không phải giao dịch thật)'),
  );
  fireEvent.click(screen.getByLabelText('Tôi xác nhận ảnh và giao dịch này là dữ liệu thử nghiệm'));
  const save = screen.getByRole('button', { name: 'Lưu giao dịch chờ đối soát' });
  fireEvent.click(save);
  expect(mocks.api.registerWithEvidence).toHaveBeenCalledTimes(1);
  expect(mocks.api.registerWithEvidence.mock.calls[0][0]).toMatchObject({
    isDevelopmentDemo: true,
    humanVerified: true,
    statementReference: '',
    proposedInvoiceId: null,
  });
  expect(screen.getByRole('button', { name: 'Đang tải ảnh và lưu…' })).toBeDisabled();
  fireEvent.submit(save.closest('form')!);
  expect(mocks.api.registerWithEvidence).toHaveBeenCalledTimes(1);
  expect(mocks.api.allocate).not.toHaveBeenCalled();
  complete({ ...transfer, status: 'PendingReview', proposedInvoiceId: null });
  await screen.findByText(/Đã lưu giao dịch kèm ảnh sao kê để đối soát/);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-bank-statement');
  expect(screen.getByText(/Tiền chưa tự phân bổ vào hóa đơn/)).toBeInTheDocument();
  expect(mocks.api.allocate).not.toHaveBeenCalled();
});
it('rejects missing or invalid evidence before calling the backend and requires reconfirmation after replacement', async () => {
  mount(<RecordTransferForm invoiceId="" onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục: kiểm tra bằng chứng & xác nhận' }));
  expect(screen.getByRole('button', { name: 'Lưu giao dịch chờ đối soát' })).toBeDisabled();
  const input = screen.getByLabelText('Chọn ảnh sao kê PNG hoặc JPEG');
  fireEvent.change(input, {
    target: { files: [new File(['not an image'], 'bad.pdf', { type: 'application/pdf' })] },
  });
  expect(screen.getByText('Chỉ chấp nhận ảnh PNG hoặc JPEG.')).toBeInTheDocument();
  expect(mocks.api.registerWithEvidence).not.toHaveBeenCalled();

  const oversized = new File(['synthetic'], 'large.jpg', { type: 'image/jpeg' });
  Object.defineProperty(oversized, 'size', { value: 5 * 1024 * 1024 + 1 });
  fireEvent.change(input, { target: { files: [oversized] } });
  expect(
    screen.getByText('Ảnh phải có dung lượng lớn hơn 0 và không quá 5 MB.'),
  ).toBeInTheDocument();

  const first = new File(['synthetic'], 'first.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [first] } });
  expect(
    await screen.findByAltText('Xem trước ảnh sao kê đã chọn, chưa được tải lên'),
  ).toHaveAttribute('src', 'blob:synthetic-bank-statement');
  fireEvent.click(screen.getByLabelText('Tôi đã đối chiếu sao kê và xác minh tiền thực nhận'));
  expect(screen.getByRole('button', { name: 'Lưu giao dịch chờ đối soát' })).toBeEnabled();
  fireEvent.change(input, {
    target: { files: [new File(['bad'], 'another.pdf', { type: 'application/pdf' })] },
  });
  expect(screen.queryByText(/Ảnh đã chọn: first.jpg/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Lưu giao dịch chờ đối soát' })).toBeDisabled();
  const replacement = new File(['synthetic replacement'], 'replacement.jpg', {
    type: 'image/jpeg',
  });
  fireEvent.change(input, { target: { files: [replacement] } });
  expect(screen.getByText(/Ảnh đã chọn: replacement.jpg/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Lưu giao dịch chờ đối soát' })).toBeDisabled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-bank-statement');
});
it('keeps demo evidence clearly separate from real bank verification', () => {
  mount(<RecordTransferForm invoiceId="" onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục: kiểm tra bằng chứng & xác nhận' }));
  fireEvent.click(
    screen.getByLabelText('Dữ liệu tổng hợp Development/Testing (không phải giao dịch thật)'),
  );
  expect(
    screen.getByText(/Chỉ dùng ảnh sao kê thử nghiệm không chứa dữ liệu ngân hàng thật/),
  ).toBeInTheDocument();
  expect(
    screen.getByLabelText('Tôi xác nhận ảnh và giao dịch này là dữ liệu thử nghiệm'),
  ).toBeInTheDocument();
  expect(mocks.api.registerWithEvidence).not.toHaveBeenCalled();
});
it('sends the verified image and transfer data in one idempotent private multipart request', async () => {
  const request = vi.fn().mockResolvedValue(transfer);
  const client = paymentClient(request);
  const file = new File(['synthetic'], 'evidence.png', { type: 'image/png' });
  const input = {
    providerIdentity: 'SYNTHETIC',
    bankReference: 'SYN-001',
    amount: '100000',
    currency: 'VND' as const,
    occurredAt: transfer.occurredAt,
    transferDescription: '',
    statementReference: '',
    verificationReason: 'Confirmed synthetic data',
    proposedInvoiceId: null,
    humanVerified: true,
    isDevelopmentDemo: true,
  };
  await client.registerWithEvidence(input, file, 'synthetic-idempotency-key');
  const [path, options] = request.mock.calls[0];
  expect(path).toBe('/api/v1/payment-transactions/manual-with-evidence');
  expect(options.method).toBe('POST');
  expect(options.headers).toEqual({ 'Idempotency-Key': 'synthetic-idempotency-key' });
  expect(options.body).toBeInstanceOf(FormData);
  expect(options.body.get('input')).toBe(JSON.stringify(input));
  expect((options.body.get('evidence') as File).name).toBe('sao-ke.png');
  expect(options.headers).not.toHaveProperty('Content-Type');
  await client.transferEvidence('transfer', new AbortController().signal);
  expect(request).toHaveBeenLastCalledWith(
    '/api/v1/payment-transactions/transfer/evidence',
    { signal: expect.any(AbortSignal) },
    'blob',
  );
});
it('loads a saved statement image only through the authorized detail action', async () => {
  const withEvidence = {
    ...transfer,
    statementEvidence: { contentType: 'image/png', length: 8, sha256: 'abc123' },
  };
  mocks.api.transfer.mockResolvedValue(withEvidence);
  mount(<ReconcileTransfer transfer={withEvidence} />);
  expect(await screen.findByText('Ảnh sao kê đã lưu')).toBeInTheDocument();
  expect(mocks.api.transferEvidence).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh sao kê' }));
  expect(await screen.findByRole('img', { name: 'ảnh sao kê' })).toHaveAttribute(
    'src',
    'blob:synthetic-bank-statement',
  );
  expect(mocks.api.transferEvidence).toHaveBeenCalledWith('transfer', expect.any(AbortSignal));
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Xem ảnh sao kê' })).getByRole('button', {
      name: 'Đóng',
    }),
  );
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-bank-statement');
  expect(mocks.api.allocate).not.toHaveBeenCalled();
});
it.each([
  ['bank_statement_image_required', 'Chọn ảnh sao kê PNG hoặc JPEG'],
  ['bank_statement_image_too_large', 'Ảnh sao kê vượt quá 5 MB'],
  ['bank_statement_image_type_invalid', 'Ảnh sao kê phải là tệp PNG hoặc JPEG'],
  ['bank_statement_image_invalid', 'Nội dung tệp không phải ảnh'],
  ['bank_statement_image_conflict', 'Ảnh sao kê hoặc giao dịch đã thay đổi'],
  ['bank_statement_image_integrity_failed', 'Ảnh sao kê không còn khớp'],
  ['bank_statement_image_missing', 'Ảnh sao kê đã ghi nhận không còn'],
  ['bank_statement_storage_unavailable', 'Kho lưu trữ ảnh sao kê tạm thời'],
])(
  'explains backend evidence failure %s without pretending payment was recorded',
  (code, message) => {
    expect(paymentError({ status: 400, problem: { code } })).toContain(message);
  },
);
it('explains a storage outage even without a JSON problem payload', () => {
  expect(paymentError({ status: 503 })).toContain('Dịch vụ thanh toán hoặc kho lưu trữ');
});
it('retries an unavailable payment overview and renders the real empty state', async () => {
  mocks.api.invoices.mockRejectedValue({ status: 503 });
  mount(<PaymentManagementPage />);
  fireEvent.click(screen.getByRole('tab', { name: 'Hóa đơn và số dư' }));
  const retry = await screen.findByText('Thử lại');
  mocks.api.invoices.mockResolvedValue({ items: [], totalCount: 0 });
  fireEvent.click(retry);
  await screen.findByText('Không có hóa đơn phù hợp bộ lọc.');
});
it('opens a payment detail drawer with the chosen room and closes without changing payment data', async () => {
  mocks.api.invoices.mockResolvedValue({
    items: [
      {
        invoiceId: id,
        locationName: 'Cơ sở tổng hợp',
        roomNumber: 'P102',
        billingPeriod: '2026-11-01',
        dueDate: '2026-11-30',
        outstandingAmount: '100000',
        paymentStatus: 'Unpaid',
        overdueDays: 0,
      },
    ],
    totalCount: 1,
  });
  mount(<PaymentManagementPage />);
  fireEvent.click(screen.getByRole('tab', { name: 'Hóa đơn và số dư' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Xem thanh toán' }));
  expect(await screen.findByText('Chi tiết thanh toán hóa đơn')).toBeInTheDocument();
  expect(screen.getByText('Cơ sở tổng hợp · Phòng P102 · Kỳ 2026-11')).toBeInTheDocument();
  await waitFor(() => expect(mocks.api.payment).toHaveBeenCalledWith(id, expect.any(AbortSignal)));
  fireEvent.click(screen.getByRole('button', { name: 'Đóng chi tiết thanh toán' }));
  await waitFor(() =>
    expect(screen.queryByText('Chi tiết thanh toán hóa đơn')).not.toBeInTheDocument(),
  );
  expect(mocks.api.allocate).not.toHaveBeenCalled();
  expect(mocks.api.register).not.toHaveBeenCalled();
});
it('does not let hidden invoice status or overdue filters alter the verified history tab', async () => {
  mount(<PaymentManagementPage />);
  fireEvent.click(screen.getByRole('tab', { name: 'Hóa đơn và số dư' }));
  fireEvent.click(screen.getByText('Đã đủ tiền'));
  fireEvent.click(screen.getByText('Quá hạn'));
  await waitFor(() =>
    expect(mocks.api.invoices.mock.calls.at(-1)?.[0]).toMatchObject({
      paymentStatus: 'Paid',
      overdueOnly: true,
    }),
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Lịch sử đã xác minh' }));
  await waitFor(() =>
    expect(mocks.api.history.mock.calls.at(-1)?.[0]).toMatchObject({
      paymentStatus: '',
      overdueOnly: false,
    }),
  );
});
it('opens the review queue immediately, keeps operations in three tabs and settings in a menu', async () => {
  mount(<PaymentManagementPage />);
  expect(screen.queryByText('Bắt đầu từ công việc cần xử lý')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('region', { name: 'Thao tác thanh toán nhanh' }),
  ).not.toBeInTheDocument();
  const tabs = screen.getByRole('tablist', { name: 'Nghiệp vụ thanh toán' });
  expect(within(tabs).getAllByRole('tab')).toHaveLength(3);
  expect(within(tabs).getByRole('tab', { name: 'Đối soát giao dịch' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await waitFor(() =>
    expect(mocks.api.transfers.mock.calls.at(-1)?.[0]).toMatchObject({
      paymentStatus: 'PendingReview',
      page: 1,
    }),
  );
  expect(mocks.api.invoices).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Tiện ích' }));
  expect(screen.getByRole('menuitem', { name: 'Tài khoản nhận tiền' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Webhook SePay' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Tài khoản nhận tiền' }));
  expect(screen.getByRole('button', { name: 'Tài khoản nhận tiền' })).toBeInTheDocument();
  fireEvent.click(within(tabs).getByRole('tab', { name: 'Hóa đơn và số dư' }));
  fireEvent.click(screen.getByText('Còn phải trả'));
  await waitFor(() =>
    expect(mocks.api.invoices.mock.calls.at(-1)?.[0]).toMatchObject({
      paymentStatus: 'Unpaid',
      page: 1,
    }),
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Lịch sử đã xác minh' }));
  await waitFor(() =>
    expect(mocks.api.history.mock.calls.at(-1)?.[0]).toMatchObject({
      paymentStatus: '',
      overdueOnly: false,
    }),
  );
  expect(mocks.api.allocate).not.toHaveBeenCalled();
  expect(mocks.api.register).not.toHaveBeenCalled();
});
const testReceivingLocationId = '11111111-2222-4333-8444-555555555555';
const configuredReceivingAccount = {
  locationId: testReceivingLocationId,
  bankIdentifier: '970422',
  accountNumber: '0000000001',
  accountHolder: 'NGUYEN QUOC HUY',
  enabled: true,
  isDevelopmentDemo: true,
  version: 15,
};
async function openReceivingAccountSettings() {
  mocks.api.request.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/v1/receiving-bank-accounts/owner') {
      if (init?.method === 'PUT') return mocks.api.saveAccount(JSON.parse(String(init.body)));
      return mocks.api.account();
    }
    if (url === '/api/v1/capture/locations')
      return [{ id: testReceivingLocationId, label: 'Cơ sở Hòa Lạc' }];
    return [];
  });
  mount(<PaymentManagementPage />, '/payments?setupAccount=1');
  expect(screen.queryByRole('combobox', { name: 'Cơ sở' })).not.toBeInTheDocument();
  return screen.findByText('Tài khoản nhận tiền chung cho tất cả cơ sở');
}
it('shows an already confirmed receiving account as saved and prevents an unchanged resubmission', async () => {
  mocks.api.account.mockResolvedValue(configuredReceivingAccount);
  await openReceivingAccountSettings();
  await screen.findByText('Đã xác nhận và lưu cấu hình phiên bản 15.');
  const approved = screen.getByRole('checkbox', {
    name: 'Tôi đã kiểm tra và phê duyệt thông tin tài khoản nhận',
  });
  expect(approved).toBeChecked();
  expect(screen.getByRole('button', { name: 'Lưu tài khoản nhận tiền' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'BIN ngân hàng (6 số)' }), {
    target: { value: '970418' },
  });
  expect(approved).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Lưu tài khoản nhận tiền' })).toBeDisabled();
  fireEvent.click(approved);
  expect(screen.getByRole('button', { name: 'Lưu tài khoản nhận tiền' })).toBeEnabled();
  expect(mocks.api.saveAccount).not.toHaveBeenCalled();
});
it('preserves confirmation and gives explicit success feedback after a receiving account is saved', async () => {
  mocks.api.account.mockResolvedValueOnce(null).mockResolvedValue({
    ...configuredReceivingAccount,
    version: 1,
  });
  mocks.api.saveAccount.mockResolvedValue({ ...configuredReceivingAccount, version: 1 });
  await openReceivingAccountSettings();
  fireEvent.change(screen.getByRole('textbox', { name: 'BIN ngân hàng (6 số)' }), {
    target: { value: '970422' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Số tài khoản nhận tiền' }), {
    target: { value: '0000000001' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Chủ tài khoản (in hoa không dấu)' }), {
    target: { value: 'NGUYEN QUOC HUY' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Bật hướng dẫn nhận tiền' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Tài khoản thử nghiệm (Test)' }));
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'Tôi đã kiểm tra và phê duyệt thông tin tài khoản nhận',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tài khoản nhận tiền' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Đã lưu tài khoản nhận tiền thành công (phiên bản 1).',
  );
  await waitFor(() => expect(mocks.api.account).toHaveBeenCalledTimes(2));
  expect(
    screen.getByRole('checkbox', {
      name: 'Tôi đã kiểm tra và phê duyệt thông tin tài khoản nhận',
    }),
  ).toBeChecked();
  expect(screen.getByRole('button', { name: 'Lưu tài khoản nhận tiền' })).toBeDisabled();
  expect(mocks.api.saveAccount).toHaveBeenCalledTimes(1);
  expect(mocks.api.saveAccount).toHaveBeenCalledWith(
    expect.objectContaining({
      bankIdentifier: '970422',
      expectedVersion: 0,
      humanVerified: true,
      enabled: true,
      isDevelopmentDemo: true,
    }),
  );
  expect(mocks.api.request).toHaveBeenCalledWith(
    '/api/v1/receiving-bank-accounts/owner',
    expect.objectContaining({ method: 'PUT' }),
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Số tài khoản nhận tiền' }), {
    target: { value: '0000000002' },
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(
    screen.getByRole('checkbox', {
      name: 'Tôi đã kiểm tra và phê duyệt thông tin tài khoản nhận',
    }),
  ).not.toBeChecked();
});
it('keeps edited receiving account fields and approval for retry after a failed save', async () => {
  mocks.api.account.mockResolvedValue(configuredReceivingAccount);
  mocks.api.saveAccount.mockRejectedValue({
    status: 409,
    code: 'receiving_account_version_changed',
  });
  await openReceivingAccountSettings();
  fireEvent.change(screen.getByRole('textbox', { name: 'Số tài khoản nhận tiền' }), {
    target: { value: '0000000002' },
  });
  const approved = screen.getByRole('checkbox', {
    name: 'Tôi đã kiểm tra và phê duyệt thông tin tài khoản nhận',
  });
  fireEvent.click(approved);
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tài khoản nhận tiền' }));
  expect(await screen.findByText('Tài khoản nhận đã thay đổi. Hãy tải lại.')).toBeInTheDocument();
  expect(screen.queryByText(/Đã lưu tài khoản nhận tiền thành công/)).not.toBeInTheDocument();
  expect(approved).toBeChecked();
  expect(screen.getByRole('textbox', { name: 'Số tài khoản nhận tiền' })).toHaveValue('0000000002');
  expect(screen.getByRole('button', { name: 'Lưu tài khoản nhận tiền' })).toBeEnabled();
  expect(mocks.api.saveAccount).toHaveBeenCalledTimes(1);
});
it('explains a rejected demo receiving account and preserves fields without silently changing its classification', async () => {
  mocks.api.account.mockResolvedValue(configuredReceivingAccount);
  mocks.api.saveAccount.mockRejectedValue({
    status: 400,
    code: 'development_receiving_account_unavailable',
  });
  await openReceivingAccountSettings();
  fireEvent.change(screen.getByRole('textbox', { name: 'Số tài khoản nhận tiền' }), {
    target: { value: '0000000002' },
  });
  const approved = screen.getByRole('checkbox', {
    name: 'Tôi đã kiểm tra và phê duyệt thông tin tài khoản nhận',
  });
  const demo = screen.getByRole('checkbox', { name: 'Tài khoản thử nghiệm (Test)' });
  fireEvent.click(approved);
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tài khoản nhận tiền' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Môi trường hiện tại không cho phép lưu tài khoản nhận tiền tổng hợp.',
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Staging đã bật SePay Test');
  expect(screen.getByRole('textbox', { name: 'Số tài khoản nhận tiền' })).toHaveValue('0000000002');
  expect(approved).toBeChecked();
  expect(demo).toBeChecked();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.click(demo);
  expect(approved).not.toBeChecked();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Lưu tài khoản nhận tiền' })).toBeDisabled();
  expect(mocks.api.saveAccount).toHaveBeenCalledTimes(1);
});
it('provides visible overdue debt action and accessible secondary filters', async () => {
  mocks.api.debts.mockResolvedValue({ items: [], totalCount: 0 });
  mount(<PaymentManagementPage debtOnly />);
  expect(screen.queryByText('Bạn muốn theo dõi khoản nợ nào?')).not.toBeInTheDocument();
  const quickActions = screen.getByRole('region', { name: 'Lọc nhanh công nợ' });
  expect(within(quickActions).getAllByRole('button')).toHaveLength(3);
  expect(screen.queryByText('Lịch sử thanh toán đã xác minh')).not.toBeInTheDocument();
  fireEvent.click(within(quickActions).getByRole('button', { name: 'Xem hóa đơn quá hạn' }));
  await waitFor(() =>
    expect(mocks.api.debts.mock.calls.at(-1)?.[0]).toMatchObject({ overdueOnly: true, page: 1 }),
  );
  fireEvent.click(within(quickActions).getByRole('button', { name: 'Xem tất cả công nợ' }));
  await waitFor(() =>
    expect(mocks.api.debts.mock.calls.at(-1)?.[0]).toMatchObject({ overdueOnly: false, page: 1 }),
  );
  const showFilters = screen.getByRole('button', { name: 'Lọc thêm theo cơ sở / kỳ' });
  expect(showFilters).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(showFilters);
  expect(screen.getByRole('button', { name: 'Thu gọn bộ lọc' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(screen.getByLabelText('Kỳ hóa đơn cần lọc')).toBeInTheDocument();
  const historyToggle = screen.getByRole('button', { name: 'Xem lịch sử thu tiền' });
  expect(historyToggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(historyToggle);
  expect(screen.getByRole('button', { name: 'Ẩn lịch sử thu tiền' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
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
  fireEvent.click(screen.getByRole('tab', { name: 'Hóa đơn và số dư' }));
  await screen.findByText(/Cơ sở tổng hợp · PAY-TEST/);
  await screen.findByRole('cell', { name: /^100\.000\s₫$/ });
  fireEvent.click(screen.getByRole('tab', { name: 'Lịch sử đã xác minh' }));
  await screen.findByText('Trang lịch sử 1 · 0 thanh toán');
  fireEvent.click(screen.getByRole('tab', { name: 'Đối soát giao dịch' }));
  expect(
    screen.queryByLabelText('Tôi đã đối chiếu giao dịch và hóa đơn theo sao kê'),
  ).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Kiểm tra & đối soát' }));
  fireEvent.click(
    await screen.findByLabelText('Tôi đã đối chiếu giao dịch và hóa đơn theo sao kê'),
  );
  fireEvent.click(screen.getByText('Xác nhận phân bổ tiền'));
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Xác nhận đối soát'));
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Xác nhận đối soát giao dịch?' }),
    ).not.toBeInTheDocument(),
  );
  const reviewDrawer = screen.getByRole('dialog', { name: 'Chi tiết đối soát giao dịch' });
  fireEvent.click(within(reviewDrawer).getByRole('button', { name: 'Đóng chi tiết giao dịch' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Chi tiết đối soát giao dịch' }),
    ).not.toBeInTheDocument(),
  );
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
  expect(mocks.api.payers).not.toHaveBeenCalled();
});
