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
  mocks.api.get.mockResolvedValue(value);
  mocks.api.request.mockResolvedValue([]);
  mocks.api.list.mockResolvedValue({ items: [], totalCount: 0 });
});
afterEach(cleanup);
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
  expect(screen.getByLabelText('Giá trị sau điều chỉnh (VND)')).toHaveValue('90000');
});
it('retries the real list and displays an explicit empty state', async () => {
  mocks.api.list.mockRejectedValue({ status: 503 });
  mount(<OwnerAdjustmentList />);
  const retry = await screen.findByText('Thử lại');
  mocks.api.list.mockResolvedValue({ items: [], totalCount: 0 });
  fireEvent.click(retry);
  await screen.findByText('Không có yêu cầu phù hợp.');
});
it('opens an adjustment next to the list and returns without resetting list context', async () => {
  mocks.api.list.mockResolvedValue({ items: [value], totalCount: 1 });
  mount(<OwnerAdjustmentList />);
  fireEvent.click(await screen.findByRole('button', { name: 'Xem & xử lý' }));
  expect(await screen.findByText('Xem & xử lý yêu cầu')).toBeInTheDocument();
  expect(await screen.findByText('Sai tiền thuê', { exact: false })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  await waitFor(() => expect(screen.queryByText('Xem & xử lý yêu cầu')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Xem & xử lý' })).toBeInTheDocument();
});
