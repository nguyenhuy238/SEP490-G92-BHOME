import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { FinancialReportsApiPage } from './FinancialReportsApiPage';
const mock = vi.hoisted(() => ({ locations: vi.fn(), rooms: vi.fn(), report: vi.fn() }));
vi.mock('../expenses/useFinanceApi', () => ({ useFinanceApi: () => mock }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
beforeEach(() => {
  vi.resetAllMocks();
  mock.locations.mockResolvedValue([]);
  mock.rooms.mockResolvedValue([]);
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
  verifiedDepositReturns: '2900000',
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
it('shows verified deposit principal separately and explains separate deposit offsets', async () => {
  mock.report.mockResolvedValue(backendReport);
  mount();
  request();
  await screen.findByText('Hoàn gốc cọc đã xác minh trong kỳ: 2.900.000 ₫');
  expect(screen.getByText(/không ghi thành tiền chuyển khoản mới/)).toBeInTheDocument();
});
it('keeps a missing deposit classification distinct from a verified zero', async () => {
  mock.report.mockResolvedValue({ ...backendReport, verifiedDepositReturns: null });
  mount();
  request();
  await screen.findByText('Hoàn gốc cọc đã xác minh trong kỳ: Chưa có dữ liệu phân loại');
});
it('shows backend settlement debt, cash and deposit offsets as separate sources', async () => {
  mock.report.mockResolvedValue({
    ...backendReport,
    settlementSources: {
      approvedCharges: '600000',
      outstandingNow: '200000',
      verifiedBankCollections: '0',
      depositOffsetsApplied: '400000',
      holdingForfeitures: '100000',
    },
  });
  mount();
  request();
  await screen.findByText('Khoản phải thu trả phòng đã duyệt: 600.000 ₫');
  expect(screen.getByText('Nợ khoản phải thu trả phòng hiện tại: 200.000 ₫')).toBeInTheDocument();
  expect(screen.getByText('Tiền ngân hàng phân bổ vào khoản phải thu: 0 ₫')).toBeInTheDocument();
  expect(screen.getByText('Cọc cấn trừ được duyệt trong kỳ: 400.000 ₫')).toBeInTheDocument();
  expect(
    screen.getByText('Cọc Holding không hoàn theo quyết định hủy: 100.000 ₫'),
  ).toBeInTheDocument();
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
it('keeps negative server totals exact, including amounts beyond safe integers', async () => {
  mock.report.mockResolvedValue({
    ...backendReport,
    total: { ...backendReport.total, operatingProfit: '-999999999999999999' },
  });
  mount();
  request();
  await screen.findByText('Lợi nhuận vận hành: -999.999.999.999.999.999 ₫');
  expect(screen.getByText('Điều chỉnh đã duyệt: -100 ₫')).toBeInTheDocument();
});
it('selects a scoped Room by name and clears it when the Location changes', async () => {
  mock.locations.mockResolvedValue([
    { id: 'a', label: 'Cơ sở A' },
    { id: 'b', label: 'Cơ sở B' },
  ]);
  mock.rooms.mockImplementation(async (id) =>
    id === 'a' ? [{ id: 'room', label: 'Phòng 101' }] : [],
  );
  mock.report.mockResolvedValue(backendReport);
  mount();
  expect(screen.getByRole('combobox', { name: 'Phòng' })).toBeDisabled();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Cơ sở' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Cơ sở A' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Phòng' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Phòng 101' }));
  request();
  await screen.findByText('Lợi nhuận vận hành: 700 ₫');
  expect(mock.report).toHaveBeenLastCalledWith(
    expect.objectContaining({ locationId: 'a', roomId: 'room' }),
    expect.any(AbortSignal),
  );
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Cơ sở' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Cơ sở B' }));
  expect(screen.getByRole('combobox', { name: 'Phòng' })).toHaveValue('');
  request();
  await screen.findByText('Lợi nhuận vận hành: 700 ₫');
  expect(mock.report).toHaveBeenLastCalledWith(
    { from: '2026-11-01', to: '2026-11-30', locationId: 'b' },
    expect.any(AbortSignal),
  );
});
it('rejects a reversed date range before requesting financial figures', () => {
  mount();
  fireEvent.change(screen.getByLabelText(/Từ ngày/), { target: { value: '2026-11-30' } });
  fireEvent.change(screen.getByLabelText(/Đến ngày/), { target: { value: '2026-11-01' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Xem báo cáo' }).closest('form')!);
  expect(screen.getByText('Chọn khoảng ngày hợp lệ.')).toBeInTheDocument();
  expect(mock.report).not.toHaveBeenCalled();
});
