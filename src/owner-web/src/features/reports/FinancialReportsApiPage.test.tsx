import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { FinancialReportsApiPage } from './FinancialReportsApiPage';
const mock = vi.hoisted(() => ({ locations: vi.fn(), report: vi.fn() }));
vi.mock('../expenses/useFinanceApi', () => ({ useFinanceApi: () => mock }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
beforeEach(() => {
  vi.resetAllMocks();
  mock.locations.mockResolvedValue([]);
});
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FinancialReportsApiPage />
    </QueryClientProvider>,
  );
}
function request() {
  fireEvent.change(screen.getByLabelText(/Từ ngày/), { target: { value: '2026-11-01' } });
  fireEvent.change(screen.getByLabelText(/Đến ngày/), { target: { value: '2026-11-30' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Xem báo cáo' }).closest('form')!);
}
it('displays backend figures and unavailable payback without calculating or substituting demo amounts', async () => {
  mock.report.mockResolvedValue({
    total: {
      issued: '1000',
      approvedAdjustments: '-100',
      verifiedCollections: '600',
      operatingExpenses: '200',
      operatingProfit: '700',
      outstandingNow: '300',
      initialInvestment: '0',
      netOperatingCashFlow: '400',
      totalRooms: 10,
      occupiedRooms: 6,
    },
    locations: [],
    capital: {
      initialInvestment: '0',
      netRecovery: '400',
      remainingCapital: '0',
      recoveryPercent: null,
      estimatedRemainingMonths: null,
      unavailableReason: 'initial_investment_required',
    },
  });
  mount();
  expect(mock.report).not.toHaveBeenCalled();
  request();
  await screen.findByText('Lợi nhuận vận hành: 700 ₫');
  expect(screen.getByText('Ước tính số tháng còn lại: Chưa xác định')).toBeInTheDocument();
  expect(mock.report).toHaveBeenCalledWith(
    { from: '2026-11-01', to: '2026-11-30', locationId: undefined },
    expect.any(AbortSignal),
  );
});
it('reports API failure without a financial result', async () => {
  mock.report.mockRejectedValue({ status: 503 });
  mount();
  request();
  await screen.findByText('Không thể tải hoặc lưu dữ liệu tài chính. Vui lòng thử lại.');
  expect(screen.queryByText('Vốn & Thu hồi')).not.toBeInTheDocument();
});
