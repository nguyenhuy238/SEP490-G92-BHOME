import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { FinancialReportsApiPage } from './FinancialReportsApiPage';
import { financeMonthPeriod } from '../finance/monthPeriods';
const mock = vi.hoisted(() => ({
  locations: vi.fn(),
  rooms: vi.fn(),
  report: vi.fn(),
  expenses: vi.fn(),
}));
vi.mock('../expenses/useFinanceApi', () => ({ useFinanceApi: () => mock }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
beforeEach(() => {
  vi.resetAllMocks();
  mock.locations.mockResolvedValue([]);
  mock.rooms.mockResolvedValue([]);
  mock.report.mockResolvedValue(backendReport);
  mock.expenses.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25, totalAmount: '0' });
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
  const toggle = screen.getByRole('button', { name: /bộ lọc chi tiết/i });
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
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
it('loads the last completed month from the API immediately and respects a changed report period', async () => {
  mock.report.mockResolvedValue(backendReport);
  mount();
  const lastMonth = financeMonthPeriod(-1);
  await screen.findByText('Lợi nhuận vận hành: 700 ₫');
  expect(mock.report).toHaveBeenCalledWith(
    { from: lastMonth.from, to: lastMonth.to, locationId: undefined, includeComparison: true },
    expect.any(AbortSignal),
  );
  request();
  await screen.findByText('Lợi nhuận vận hành: 700 ₫');
  expect(screen.getByText('Phạm vi: Toàn chuỗi')).toBeInTheDocument();
  expect(screen.getByText('Ước tính số tháng còn lại: Chưa xác định')).toBeInTheDocument();
  expect(mock.report).toHaveBeenCalledWith(
    { from: '2026-11-01', to: '2026-11-30', locationId: undefined, includeComparison: true },
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
it('explains missing asset prices instead of presenting a zero capital recovery', async () => {
  mock.report.mockResolvedValue({
    ...backendReport,
    total: {
      ...backendReport.total,
      management: {
        cashCapital: {
          initialInvestment: '1000',
          netRecovery: null,
          remainingCapital: null,
          recoveryPercent: null,
          estimatedRemainingMonths: null,
          unavailableReason: 'investment_basis_required',
        },
      },
    },
  });
  mount();
  await screen.findByText(
    'Chưa đủ nguyên giá tài sản để tính vốn còn lại và tiến độ thu hồi. Bổ sung giá mua tại cơ sở.',
  );
  expect(screen.getByText('Vốn còn lại: Chưa xác định')).toBeInTheDocument();
  expect(screen.getAllByText('Tỷ lệ thu hồi: Chưa xác định').length).toBeGreaterThan(0);
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
  expect(screen.getByText(/Bộ lọc đang chọn:.*Tải thất bại/)).toBeInTheDocument();
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
  expect(screen.queryByRole('combobox', { name: 'Phòng' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc chi tiết' }));
  expect(screen.getByRole('combobox', { name: 'Phòng' })).toBeDisabled();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Cơ sở' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Cơ sở A' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Phòng' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Phòng 101' }));
  request();
  await screen.findByText('Lợi nhuận vận hành: 700 ₫');
  expect(mock.report).toHaveBeenLastCalledWith(
    expect.objectContaining({ locationId: 'a', roomId: 'room', includeComparison: true }),
    expect.any(AbortSignal),
  );
  expect(screen.getByText('Phạm vi: Cơ sở A · Phòng 101')).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Cơ sở' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Cơ sở B' }));
  expect(screen.getByRole('combobox', { name: 'Phòng' })).toHaveValue('');
  expect(screen.getByText('Phạm vi: Cơ sở A · Phòng 101')).toBeInTheDocument();
  request();
  await screen.findByText('Lợi nhuận vận hành: 700 ₫');
  expect(screen.getByText('Phạm vi: Cơ sở B')).toBeInTheDocument();
  expect(mock.report).toHaveBeenLastCalledWith(
    { from: '2026-11-01', to: '2026-11-30', locationId: 'b', includeComparison: true },
    expect.any(AbortSignal),
  );
});
it('rejects a reversed date range without sending another report request', () => {
  mount();
  const requestsBeforeSubmit = mock.report.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc chi tiết' }));
  fireEvent.change(screen.getByLabelText(/Từ ngày/), { target: { value: '2026-11-30' } });
  fireEvent.change(screen.getByLabelText(/Đến ngày/), { target: { value: '2026-11-01' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Xem báo cáo' }).closest('form')!);
  expect(screen.getByText('Giá trị phải từ 30/11/2026 trở lên.')).toBeInTheDocument();
  expect(mock.report).toHaveBeenCalledTimes(requestsBeforeSubmit);
});
it('offers a complete month shortcut and distinguishes unsent filter changes from loaded results', async () => {
  mock.report.mockResolvedValue(backendReport);
  mount();
  const preset = financeMonthPeriod(-1);
  expect(screen.queryByLabelText(/Từ ngày/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc chi tiết' }));
  expect(screen.getByLabelText(/Từ ngày/)).toHaveValue(preset.from);
  expect(screen.getByLabelText(/Đến ngày/)).toHaveValue(preset.to);
  await screen.findByText('Lợi nhuận vận hành: 700 ₫');
  expect(
    screen.getByText(
      `Kỳ báo cáo đã tải: ${preset.from.split('-').reverse().join('/')} – ${preset.to.split('-').reverse().join('/')}`,
    ),
  ).toBeInTheDocument();
  expect(mock.report).toHaveBeenCalledWith(
    { from: preset.from, to: preset.to, locationId: undefined, includeComparison: true },
    expect.any(AbortSignal),
  );
  fireEvent.change(screen.getByLabelText(/Từ ngày/), { target: { value: '2026-01-01' } });
  expect(screen.getByText(/số liệu đang hiển thị vẫn thuộc kỳ trước đó/)).toBeInTheDocument();
  expect(screen.getByText(/Bộ lọc đang chọn: 01\/01\/2026.*Chưa áp dụng/)).toBeInTheDocument();
  expect(
    screen.getByText(
      `Kỳ báo cáo đã tải: ${preset.from.split('-').reverse().join('/')} – ${preset.to.split('-').reverse().join('/')}`,
    ),
  ).toBeInTheDocument();
  expect(mock.report).toHaveBeenCalledTimes(1);
});
it('loads the last complete month automatically without requiring a filter submission', async () => {
  mock.report.mockResolvedValue(backendReport);
  mount();
  const period = financeMonthPeriod(-1);
  await screen.findByText('Lợi nhuận vận hành: 700 ₫');
  expect(screen.getByText(/Bộ lọc đang chọn:.*Đã tải/)).toBeInTheDocument();
  expect(mock.report).toHaveBeenCalledWith(
    { from: period.from, to: period.to, locationId: undefined, includeComparison: true },
    expect.any(AbortSignal),
  );
});
it('keeps the summary visible and lets Owner reveal detailed reconciliation, occupancy and capital sections', async () => {
  mock.report.mockResolvedValue(backendReport);
  mount();
  await screen.findByText('Lợi nhuận vận hành: 700 ₫');
  expect(screen.getByText('Hóa đơn / khoản phải thu')).toBeInTheDocument();
  for (const heading of [/Đối chiếu chi tiết số liệu/, /Tỷ lệ lấp đầy/, /Tiến độ thu hồi vốn/]) {
    const disclosure = screen.getByRole('button', { name: heading });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  }
  expect(mock.report).toHaveBeenCalledTimes(1);
});

it('renders the management acceptance figures and opens both periods of actual expense sources', async () => {
  mock.report.mockResolvedValue({
    ...backendReport,
    total: {
      ...backendReport.total,
      issued: '100000000',
      approvedAdjustments: '0',
      operatingExpenses: '30000000',
      operatingProfit: '70000000',
      outstandingNow: '4000000',
      management: {
        revenue: '100000000',
        actualBusinessCollections: '96000000',
        currentOutstanding: '4000000',
        periodOutstanding: '4000000',
        overdueInvoiceOutstanding: '0',
        priorPeriodCollections: '0',
        depositReceipts: '10000000',
        operatingPaymentsConfirmed: '28000000',
        operatingUnpaidConfirmed: '2000000',
        operatingUnknownPaymentAmount: '0',
        operatingCashFlow: '68000000',
        operatingMarginPercent: '70',
        depreciation: '15000000',
        profitAfterDepreciation: '55000000',
        expenseCategories: [{ category: 'Maintenance', amount: '10000000' }],
      },
    },
    comparison: {
      currentFrom: '2026-10-01',
      currentTo: '2026-10-31',
      previousFrom: '2026-09-01',
      previousTo: '2026-09-30',
      revenue: { current: '100000000', previous: '100000000', change: '0', changePercent: '0' },
      operatingExpenses: {
        current: '30000000',
        previous: '24000000',
        change: '6000000',
        changePercent: '25',
      },
      operatingProfit: {
        current: '70000000',
        previous: '76000000',
        change: '-6000000',
        changePercent: '-7.89',
      },
      expenseCategories: [
        {
          category: 'Maintenance',
          current: '10000000',
          previous: '5000000',
          change: '5000000',
          changePercent: '100',
        },
      ],
    },
  });
  mock.expenses.mockImplementation(async (filter) => ({
    total: 1,
    page: 1,
    pageSize: 25,
    totalAmount: filter.from === '2026-10-01' ? '10000000' : '5000000',
    items: [
      {
        id: filter.from,
        category: 'Maintenance',
        occurredOn: filter.from,
        amount: filter.from === '2026-10-01' ? '10000000' : '5000000',
        note: 'Chi phí sửa chữa từ chứng từ',
      },
    ],
  }));
  mount();
  await screen.findByText('55.000.000 ₫');
  for (const amount of [
    '100.000.000 ₫',
    '96.000.000 ₫',
    '28.000.000 ₫',
    '15.000.000 ₫',
    '68.000.000 ₫',
    '4.000.000 ₫',
    '2.000.000 ₫',
  ])
    expect(screen.getAllByText(amount).length).toBeGreaterThan(0);
  expect(screen.getByText(/24\.000\.000.*30\.000\.000.*6\.000\.000.*25%/)).toBeInTheDocument();
  expect(screen.getByText(/76\.000\.000.*70\.000\.000.*-6\.000\.000.*-7\.89%/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xem nguồn' }));
  await waitFor(() => expect(screen.getAllByText('Chi phí sửa chữa từ chứng từ')).toHaveLength(2));
  for (const [from, to] of [
    ['2026-10-01', '2026-10-31'],
    ['2026-09-01', '2026-09-30'],
  ])
    expect(mock.expenses).toHaveBeenCalledWith(
      {
        from,
        to,
        locationId: undefined,
        roomId: undefined,
        expenseType: 'OPERATING',
        category: 'Maintenance',
        page: 1,
        includeTotalAmount: true,
      },
      expect.any(AbortSignal),
    );
});
