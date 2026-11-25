import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { BankReceiptSourceDetails, BankRefundSourceDetails } from './BankReceiptSourceDetails';

const mock = vi.hoisted(() => ({
  bankReceiptSources: vi.fn(),
  bankReceiptRefund: vi.fn(),
  bankRefundSources: vi.fn(),
}));
vi.mock('../expenses/useFinanceApi', () => ({ useFinanceApi: () => mock }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
const filter = { from: '2026-10-01', to: '2026-10-31' };
const receipt = {
  id: 'receipt-1',
  receivedAt: '2026-10-01T00:00:00Z',
  reference: 'SYN',
  amount: '120000',
  allocated: '100000',
  grossUnallocated: '20000',
};
const page = {
  items: [receipt],
  total: 2,
  page: 1,
  pageSize: 1,
  totalReceived: '120000',
  totalGrossUnallocated: '20000',
  snapshotAt: '2026-11-01T00:00:00Z',
};
beforeEach(() => {
  vi.resetAllMocks();
  mock.bankReceiptSources.mockResolvedValue(page);
  mock.bankReceiptRefund.mockResolvedValue({
    beneficiaries: [{ id: 'payer', label: 'Người trả thử nghiệm' }],
    eligibleReceiptRefundAmount: '0',
    reservedAmount: '20000',
    refundedAmount: '0',
    requests: [{ id: 'refund', status: 'APPROVED', amount: '20000' }],
  });
});
function mount(refunds = false) {
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        {refunds ? (
          <BankRefundSourceDetails filter={filter} expected="20000" />
        ) : (
          <BankReceiptSourceDetails
            filter={filter}
            expectedReceived="120000"
            expectedUnallocated="20000"
          />
        )}
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
it('loads actual payer eligibility lazily, distinguishes gross remainder and reserved amount, and navigates to the transaction', async () => {
  mount();
  await screen.findByText(/Đã phân bổ: 100.000/);
  expect(mock.bankReceiptSources).toHaveBeenCalledWith(filter, 1, expect.any(AbortSignal));
  expect(mock.bankReceiptRefund).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Mở giao dịch' })).toHaveAttribute(
    'href',
    '/payments?transferId=receipt-1',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xem hồ sơ hoàn tiền' }));
  await screen.findByText(/Người thanh toán đã xác minh: Người trả thử nghiệm/);
  expect(screen.getByText(/Khoản đủ điều kiện hoàn theo nguồn hiện tại: 0/)).toBeInTheDocument();
  expect(screen.getByText(/Đang giữ cho yêu cầu hoàn: 20.000/)).toBeInTheDocument();
  expect(screen.queryByText(/Tenant Credit/i)).not.toBeInTheDocument();
  mock.bankReceiptSources.mockResolvedValueOnce({
    ...page,
    page: 2,
    items: [{ ...receipt, id: 'receipt-2', reference: 'SECOND' }],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  await screen.findByText(/SECOND/);
  expect(mock.bankReceiptSources).toHaveBeenLastCalledWith(filter, 2, expect.any(AbortSignal));
  expect(screen.queryByText(/Người thanh toán đã xác minh/)).not.toBeInTheDocument();
});
it('does not display gross remainder as eligible when canonical source cannot verify the payer, and supports retry', async () => {
  mock.bankReceiptRefund.mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce({
    beneficiaries: [],
    eligibleReceiptRefundAmount: null,
    reservedAmount: '0',
    refundedAmount: '0',
    requests: [],
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Xem hồ sơ hoàn tiền' }));
  await screen.findByText(/Không xác định được điều kiện hoàn tiền/);
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await screen.findByText(
    /Khoản đủ điều kiện hoàn theo nguồn hiện tại: Chưa xác định hoặc chưa đủ điều kiện/,
  );
});
it('shows refunds by execution period even if the original receipt is from a different period', async () => {
  mock.bankRefundSources.mockResolvedValue({
    items: [
      {
        id: 'refund',
        paymentId: 'old-receipt',
        amount: '20000',
        reference: 'SYN-REFUND',
        executedAt: '2026-10-02T00:00:00Z',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
    totalAmount: '20000',
  });
  mount(true);
  await screen.findByText(/Tổng nguồn: 20.000/);
  expect(screen.getByRole('link', { name: 'Mở giao dịch gốc' })).toHaveAttribute(
    'href',
    '/payments?transferId=old-receipt',
  );
  await waitFor(() =>
    expect(mock.bankRefundSources).toHaveBeenCalledWith(filter, 1, expect.any(AbortSignal)),
  );
});
