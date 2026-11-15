import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { theme } from '../../theme/theme';
import { OwnerAdjustmentDetail, OwnerAdjustmentList } from './AdjustmentsPage';
const mocks = vi.hoisted(() => ({
  api: { get: vi.fn(), list: vi.fn(), request: vi.fn(), decide: vi.fn(), evidence: vi.fn() },
}));
vi.mock('./useAdjustmentApi', () => ({ useAdjustmentApi: () => mocks.api }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
const value = {
  id: 'request',
  invoiceId: 'invoice',
  locationName: 'Tổng hợp',
  roomNumber: 'P101',
  billingPeriod: '2026-10-01',
  requesterId: 'tenant',
  invoiceLineId: null,
  chargeCode: null,
  currentAmount: '100000',
  proposedAmount: '90000',
  reason: 'Sai tiền thuê',
  invoiceSnapshot: '{"Total":100000}',
  invoiceStatus: 'Final',
  invoiceVersion: 2,
  financialVersion: 0,
  status: 'Pending',
  version: 1,
  submittedAt: '2026-11-01T00:00:00Z',
  evidence: [],
  currentInvoice: { id: 'invoice', status: 'Final', version: 2, lines: [] },
  decision: null,
  currentFinancialVersion: 3,
  currentChargeAmount: '100000',
  financials: {
    originalIssuedAmount: '100000',
    approvedAdjustmentTotal: '0',
    effectivePayableAmount: '100000',
    allocatedPayments: '100000',
    outstandingAmount: '0',
    potentialExcessAmount: '0',
    financialVersion: 3,
    reviewStatus: 'None',
  },
};
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
  mocks.api.get.mockResolvedValue(value);
  mocks.api.request.mockResolvedValue([]);
  mocks.api.list.mockResolvedValue({ items: [], totalCount: 0 });
});
afterEach(cleanup);
it('previews and downloads adjustment evidence only through the authorized API and closes its private preview', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
  const blob = new Blob([bytes], { type: 'image/png' });
  // jsdom's Blob lacks slice().arrayBuffer(), which browsers provide.
  Object.defineProperty(blob, 'slice', {
    value: () => ({ arrayBuffer: async () => bytes.buffer }),
  });
  mocks.api.get.mockResolvedValue({
    ...value,
    evidence: [{ id: 'private-file', contentType: 'image/png', length: blob.size }],
  });
  mocks.api.evidence.mockResolvedValue(blob);
  const createUrl = vi.fn(() => 'blob:private-adjustment');
  const revokeUrl = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    mount(<OwnerAdjustmentDetail id="request" />);
    const preview = await screen.findByRole('button', { name: 'Xem Bằng chứng điều chỉnh 1' });
    expect(mocks.api.evidence).not.toHaveBeenCalled();
    fireEvent.click(preview);
    const dialog = await screen.findByRole('dialog', { name: 'Xem Bằng chứng điều chỉnh 1' });
    await within(dialog).findByRole('img', { name: 'Bằng chứng điều chỉnh 1' });
    expect(mocks.api.evidence).toHaveBeenCalledWith(
      'request',
      'private-file',
      expect.any(AbortSignal),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith('blob:private-adjustment'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Tải xuống Bằng chứng điều chỉnh 1' }),
    );
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(mocks.api.evidence).toHaveBeenCalledTimes(2);
  } finally {
    click.mockRestore();
  }
});
it('shows adjustment evidence access denial without creating a public preview URL', async () => {
  mocks.api.get.mockResolvedValue({
    ...value,
    evidence: [{ id: 'private-file', contentType: 'image/png', length: 10 }],
  });
  mocks.api.evidence.mockRejectedValue({ status: 403 });
  const createUrl = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
  mount(<OwnerAdjustmentDetail id="request" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Xem Bằng chứng điều chỉnh 1' }));
  const dialog = await screen.findByRole('dialog', { name: 'Xem Bằng chứng điều chỉnh 1' });
  expect(
    await within(dialog).findByText('Tài khoản không có quyền thao tác này.'),
  ).toBeInTheDocument();
  expect(within(dialog).queryByRole('img')).not.toBeInTheDocument();
  expect(createUrl).not.toHaveBeenCalled();
});
it('shows original and effective amounts with traceable excess rather than a refund success', async () => {
  mocks.api.get.mockResolvedValue({
    ...value,
    status: 'Approved',
    financials: {
      ...value.financials,
      effectivePayableAmount: '90000',
      approvedAdjustmentTotal: '-10000',
      potentialExcessAmount: '10000',
      reviewStatus: 'PendingReview',
    },
  });
  mount(<OwnerAdjustmentDetail id="request" />);
  await screen.findByText(/Tiền thừa chờ xem xét: 10.000/);
  expect(screen.getByText(/Tiền hóa đơn gốc: 100.000/)).toBeInTheDocument();
  expect(screen.queryByText('Phê duyệt điều chỉnh')).toBeNull();
});
it('preserves exact legacy snapshot money above JavaScript safe integer range', async () => {
  mocks.api.get.mockResolvedValue({ ...value, invoiceSnapshot: '{"Total":9007199254740993}' });
  mount(<OwnerAdjustmentDetail id="request" />);
  await screen.findByText(/Hóa đơn gốc khi gửi: 9.007.199.254.740.993/);
});
it('requires human review and dialog, sends backend revisions and blocks duplicate approval', async () => {
  let done!: (x: unknown) => void;
  mocks.api.decide.mockImplementation(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  mount(<OwnerAdjustmentDetail id="request" />);
  await screen.findByText('Sai tiền thuê', { exact: false });
  expect(screen.getByText('Phê duyệt điều chỉnh')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Lý do quyết định'), {
    target: { value: 'Đã đối chiếu' },
  });
  fireEvent.click(screen.getByLabelText('Tôi đã kiểm tra hóa đơn, số dư và bằng chứng'));
  fireEvent.click(screen.getByText('Phê duyệt điều chỉnh'));
  expect(mocks.api.decide).not.toHaveBeenCalled();
  const button = within(screen.getByRole('dialog')).getByText('Xác nhận quyết định');
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mocks.api.decide).toHaveBeenCalledTimes(1);
  expect(mocks.api.decide.mock.calls[0].slice(0, 3)).toEqual([
    'request',
    true,
    {
      expectedVersion: 1,
      expectedInvoiceVersion: 2,
      expectedFinancialVersion: 3,
      correctedAmount: '90000',
      chargeCode: null,
      reason: 'Đã đối chiếu',
      humanConfirmed: true,
    },
  ]);
  done(value);
});
it('keeps a failed decision reviewable and explains a stale financial revision', async () => {
  mocks.api.decide.mockRejectedValue({ status: 409, code: 'adjustment_invoice_changed' });
  mount(<OwnerAdjustmentDetail id="request" />);
  await screen.findByLabelText('Lý do quyết định');
  fireEvent.change(screen.getByLabelText('Lý do quyết định'), {
    target: { value: 'Owner kiểm tra' },
  });
  fireEvent.click(screen.getByLabelText('Tôi đã kiểm tra hóa đơn, số dư và bằng chứng'));
  fireEvent.click(screen.getByText('Phê duyệt điều chỉnh'));
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Xác nhận quyết định'));
  await screen.findByText('Hóa đơn hoặc số dư đã thay đổi. Tải lại, kiểm tra và xác nhận lại.');
  expect(screen.getByLabelText('Giá trị sau điều chỉnh (VND)')).toHaveValue('90.000');
});
it('does not allow approving cached financial values when refreshing the detail fails', async () => {
  mount(<OwnerAdjustmentDetail id="request" />);
  await screen.findByRole('button', { name: 'Phê duyệt điều chỉnh' });
  mocks.api.get.mockRejectedValue({ status: 503 });
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại yêu cầu' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Phê duyệt điều chỉnh' })).not.toBeInTheDocument(),
  );
  expect(mocks.api.decide).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Tải lại yêu cầu' })).toBeInTheDocument();
});
it('retries the real list and displays an explicit empty state', async () => {
  mocks.api.list.mockRejectedValue({ status: 503 });
  mount(<OwnerAdjustmentList />);
  const retry = await screen.findByText('Thử lại');
  mocks.api.list.mockResolvedValue({ items: [], totalCount: 0 });
  fireEvent.click(retry);
  await screen.findByText('Không có yêu cầu phù hợp.');
});
it('lets Owner filter the pending adjustment queue from one compact toolbar', async () => {
  mount(<OwnerAdjustmentList />);
  expect(screen.queryByText('Bắt đầu xử lý yêu cầu')).not.toBeInTheDocument();
  await waitFor(() =>
    expect(mocks.api.list.mock.calls.at(-1)?.[0]).toMatchObject({
      status: 'Pending',
      page: 1,
    }),
  );
  const status = screen.getByRole('combobox', { name: 'Trạng thái yêu cầu' });
  expect(status).toHaveTextContent('Chờ duyệt');
  fireEvent.mouseDown(status);
  fireEvent.click(screen.getByRole('option', { name: 'Tất cả yêu cầu' }));
  await waitFor(() =>
    expect(mocks.api.list.mock.calls.at(-1)?.[0]).toMatchObject({
      status: '',
      page: 1,
    }),
  );
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Trạng thái yêu cầu' }));
  fireEvent.click(screen.getByRole('option', { name: 'Chờ duyệt' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lọc chi tiết' }));
  expect(screen.getByRole('button', { name: 'Thu gọn bộ lọc' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(screen.getByLabelText('Cơ sở điều chỉnh')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Lọc theo mã hóa đơn'), {
    target: { value: 'invoice' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
  await waitFor(() =>
    expect(mocks.api.list.mock.calls.at(-1)?.[0]).toMatchObject({
      status: 'Pending',
      invoiceId: '',
      page: 1,
    }),
  );
  expect(mocks.api.decide).not.toHaveBeenCalled();
});
it('keeps the mobile request action alongside the original amount and request state', async () => {
  vi.mocked(window.matchMedia).mockImplementation((query) => ({
    matches: query.includes('max-width:599px'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  mocks.api.list.mockResolvedValue({ items: [value], totalCount: 1 });
  mount(<OwnerAdjustmentList />);
  const table = await screen.findByRole('table', { name: 'Danh sách yêu cầu điều chỉnh' });
  expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
  const identity = within(table).getByRole('rowheader');
  expect(within(identity).getByText('100.000 ₫')).toBeVisible();
  expect(within(identity).getByText('Đã phát hành')).toBeVisible();
  fireEvent.click(within(table).getByRole('button', { name: 'Xem yêu cầu điều chỉnh' }));
  expect(await screen.findByText('Phê duyệt điều chỉnh')).toBeDisabled();
  expect(mocks.api.decide).not.toHaveBeenCalled();
});
it('opens a request in a drawer and preserves the list after closing', async () => {
  mocks.api.list.mockResolvedValue({ items: [value], totalCount: 1 });
  mount(<OwnerAdjustmentList />);
  const table = await screen.findByRole('table', { name: 'Danh sách yêu cầu điều chỉnh' });
  fireEvent.click(within(table).getByRole('button', { name: 'Xem yêu cầu điều chỉnh' }));
  expect(await screen.findByRole('dialog', { name: 'Xem & xử lý yêu cầu' })).toBeInTheDocument();
  expect(await screen.findByText('Sai tiền thuê', { exact: false })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  await waitFor(() => expect(screen.queryByText('Xem & xử lý yêu cầu')).not.toBeInTheDocument());
  expect(screen.getByRole('table', { name: 'Danh sách yêu cầu điều chỉnh' })).toBeInTheDocument();
  expect(mocks.api.decide).not.toHaveBeenCalled();
});
