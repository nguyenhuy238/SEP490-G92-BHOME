import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { FinancialScenariosApiPage } from './FinancialScenariosApiPage';
import { financeMonthPeriod } from '../finance/monthPeriods';
const mock = vi.hoisted(() => ({
  locations: vi.fn(),
  scenarios: vi.fn(),
  scenario: vi.fn(),
  analyzeScenario: vi.fn(),
  saveScenario: vi.fn(),
}));
vi.mock('../expenses/useFinanceApi', () => ({ useFinanceApi: () => mock }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
const input = {
  name: 'Kịch bản tổng hợp',
  baseline: { from: '2026-11-01', to: '2026-11-30' },
  forecastMonths: 12,
  assumptions: {
    monthlyRent: '3000000',
    occupancyPercent: '80',
    collectionPercent: '90',
    monthlyUtilityServiceCost: '0',
    monthlyStaffCost: '0',
    monthlyMaintenanceCost: '0',
    monthlyOtherCost: '0',
  },
};
const result = {
  id: null,
  input,
  baseline: { snapshotAt: '2026-11-05T00:00:00Z' },
  result: {
    monthlyRevenue: '2400000',
    monthlyCollections: '2160000',
    monthlyOperatingExpenses: '0',
    monthlyProfit: '2400000',
    monthlyNetCashFlow: '2160000',
    forecastNetCashFlow: '25920000',
    remainingCapitalAtEnd: null,
    estimatedRemainingMonths: null,
    monthlyProfitDifference: '2400000',
    unavailableReason: 'initial_investment_required',
  },
  calculationVersion: 'management-constant-v1',
};
beforeEach(() => {
  vi.resetAllMocks();
  mock.locations.mockResolvedValue([]);
  mock.scenarios.mockResolvedValue([]);
  mock.analyzeScenario.mockResolvedValue(result);
});
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FinancialScenariosApiPage />
    </QueryClientProvider>,
  );
}
function fill() {
  fireEvent.change(screen.getByLabelText(/Tên kịch bản/), { target: { value: input.name } });
  fireEvent.change(screen.getByLabelText(/Dữ liệu nền từ/), {
    target: { value: input.baseline.from },
  });
  fireEvent.change(screen.getByLabelText(/Dữ liệu nền đến/), {
    target: { value: input.baseline.to },
  });
  const labels = [
    /Giá thuê giả định/,
    /Tỷ lệ lấp đầy/,
    /Tỷ lệ thu tiền/,
    /Điện nước/,
    /Chi phí Staff/,
    /Bảo trì/,
    /Chi phí khác/,
  ];
  Object.values(input.assumptions).forEach((value, index) =>
    fireEvent.change(screen.getByLabelText(labels[index]), { target: { value } }),
  );
  fireEvent.submit(screen.getByRole('button', { name: 'Phân tích' }).closest('form')!);
}
it('analyzes explicit assumptions and preserves a save key across uncertain errors', async () => {
  mock.saveScenario.mockRejectedValue({ status: 503 });
  mount();
  fill();
  await screen.findByText('Tiền thu dự kiến / tháng: 2.160.000 ₫');
  expect(mock.analyzeScenario).toHaveBeenCalledWith(input);
  fireEvent.click(screen.getByRole('button', { name: 'Lưu kịch bản' }));
  await screen.findByText('Không thể tải hoặc lưu dữ liệu tài chính. Vui lòng thử lại.');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Lưu kịch bản' })).not.toBeDisabled(),
  );
  mock.saveScenario.mockResolvedValue({ ...result, id: 'saved' });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu kịch bản' }));
  await screen.findByText('Đã lưu kịch bản và ảnh chụp dữ liệu nền.');
  expect(mock.saveScenario.mock.calls[0][1]).toBe(mock.saveScenario.mock.calls[1][1]);
  expect(screen.getByRole('button', { name: 'Lưu kịch bản' })).toBeDisabled();
});
it('loads saved snapshots for review and comparison without replaying analysis', async () => {
  mock.scenarios.mockResolvedValue([{ id: 'saved', name: 'Đã lưu', forecastMonths: 12 }]);
  mock.scenario.mockResolvedValue({ ...result, id: 'saved' });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Xem Đã lưu' }));
  await screen.findByText('Tiền thu dự kiến / tháng: 2.160.000 ₫');
  fireEvent.click(screen.getByRole('button', { name: 'So sánh Đã lưu' }));
  await screen.findByText('So sánh: Kịch bản tổng hợp');
  expect(mock.analyzeScenario).not.toHaveBeenCalled();
  expect(mock.scenario).toHaveBeenCalledTimes(2);
});
it('shows negative forecasts and the full baseline period without recalculating actual records', async () => {
  mock.analyzeScenario.mockResolvedValue({
    ...result,
    baseline: {
      ...result.baseline,
      total: { issued: '1000', verifiedCollections: '900', operatingProfit: '-500' },
    },
    result: {
      ...result.result,
      monthlyProfitDifference: '-999999999999999999',
      monthlyProfit: '-200',
    },
  });
  mount();
  fill();
  await screen.findByText('Lợi nhuận / tháng: -200 ₫');
  expect(
    screen.getByText('Chênh lệch lợi nhuận tháng so với nền: -999.999.999.999.999.999 ₫'),
  ).toBeInTheDocument();
  expect(screen.getByText('Lợi nhuận kỳ nền: -500 ₫')).toBeInTheDocument();
  expect(
    screen.getByText('Dữ liệu thực tế trong kỳ nền 01/11/2026 – 30/11/2026'),
  ).toBeInTheDocument();
  expect(mock.saveScenario).not.toHaveBeenCalled();
});
it('sets a completed baseline month with one explicit click without analyzing or saving', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Dùng tháng trước làm kỳ nền' }));
  const period = financeMonthPeriod(-1);
  expect(screen.getByLabelText(/Dữ liệu nền từ/)).toHaveValue(period.from);
  expect(screen.getByLabelText(/Dữ liệu nền đến/)).toHaveValue(period.to);
  expect(mock.analyzeScenario).not.toHaveBeenCalled();
  expect(mock.saveScenario).not.toHaveBeenCalled();
});
