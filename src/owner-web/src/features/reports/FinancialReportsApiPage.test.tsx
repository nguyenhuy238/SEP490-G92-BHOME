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
const backendReport = {
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
};
it('displays backend figures and unavailable payback without calculating or substituting demo amounts', async () => {
  mock.report.mockResolvedValue(backendReport);
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
it('displays server historical room-days separately from current occupancy', async () => {
  mock.report.mockResolvedValue({
    ...backendReport,
    historicalOccupancy: {
      status: 'Complete',
      from: '2026-11-01',
      to: '2026-11-30',
      occupiedRoomDays: 7,
      rentableRoomDays: 28,
      occupancyRate: 25,
      limitations: [],
    },
  });
  mount();
  request();
  await screen.findByText('Tỷ lệ lấp đầy trong kỳ: 25%');
  expect(screen.getByText('Ngày-phòng có người ở: 7')).toBeInTheDocument();
  expect(screen.getByText('Ngày-phòng có thể cho thuê: 28')).toBeInTheDocument();
  expect(screen.getByText('Kỳ lịch sử: 01/11/2026 – 30/11/2026')).toBeInTheDocument();
  expect(screen.getByText('Phòng đang ở hiện tại: 6/10')).toBeInTheDocument();
});
it('does not turn an empty rentable period into zero occupancy', async () => {
  mock.report.mockResolvedValue({
    ...backendReport,
    historicalOccupancy: {
      status: 'Complete',
      from: '2026-11-01',
      to: '2026-11-30',
      occupiedRoomDays: 0,
      rentableRoomDays: 0,
      occupancyRate: null,
      limitations: [],
    },
  });
  mount();
  request();
  await screen.findByText(
    'Tỷ lệ lấp đầy trong kỳ: Chưa xác định (không có ngày-phòng có thể cho thuê)',
  );
  expect(screen.queryByText('Tỷ lệ lấp đầy trong kỳ: 0%')).not.toBeInTheDocument();
});
it.each([
  ['InsufficientData', 'Chưa đủ lịch sử trạng thái cơ sở/phòng để tính tỷ lệ lấp đầy trong kỳ.'],
  ['LocationRequired', 'Chọn một cơ sở để xem tỷ lệ lấp đầy theo kỳ.'],
  ['FuturePeriod', 'Kỳ có ngày tương lai; chưa thể xác định tỷ lệ lấp đầy lịch sử.'],
])('explains %s without deriving history from current room counts', async (status, message) => {
  mock.report.mockResolvedValue({
    ...backendReport,
    historicalOccupancy: {
      status,
      from: '2026-11-01',
      to: '2026-11-30',
      occupiedRoomDays: null,
      rentableRoomDays: null,
      occupancyRate: null,
      limitations: ['Source limitation'],
    },
  });
  mount();
  request();
  await screen.findByText(message);
  expect(screen.queryByText(/Tỷ lệ lấp đầy trong kỳ:/)).not.toBeInTheDocument();
  expect(screen.getByText('Phòng đang ở hiện tại: 6/10')).toBeInTheDocument();
});
it('reports API failure without a financial result', async () => {
  mock.report.mockRejectedValue({ status: 503 });
  mount();
  request();
  await screen.findByText('Không thể tải hoặc lưu dữ liệu tài chính. Vui lòng thử lại.');
  expect(screen.queryByText('Vốn & Thu hồi')).not.toBeInTheDocument();
});
