import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { FinancialTrendPoint } from '../../../../../packages/client-core/src/finance';
import { FinancialTrendChart } from './FinancialTrendChart';

vi.mock('recharts', async () => {
  const react = await import('react');
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => children,
    LineChart: ({ data, children }: { data: unknown; children: React.ReactNode }) =>
      react.createElement(
        'div',
        { 'data-testid': 'chart', 'data-geometry': JSON.stringify(data) },
        children,
      ),
    CartesianGrid: () => null,
    Legend: () => null,
    Line: () => null,
    ReferenceLine: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});
const point: FinancialTrendPoint = {
  from: '2026-10-01',
  to: '2026-10-31',
  revenue: '9007199254740993',
  operatingExpenses: '9007199254740994',
  operatingProfit: '-1',
  actualBusinessCollections: '9007199254740991',
  operatingPaymentsConfirmed: '10',
  isComplete: true,
};
it('preserves exact money beyond safe integers and negative profit while scaling only chart geometry', () => {
  render(
    <FinancialTrendChart
      points={[point, { ...point, from: '2026-11-01', to: '2026-11-15', isComplete: false }]}
    />,
  );
  const table = screen.getByRole('table', { name: 'Số liệu xu hướng kinh doanh chính xác' });
  expect(within(table).getAllByText('9.007.199.254.740.993 ₫')).toHaveLength(2);
  expect(within(table).getAllByText('9.007.199.254.740.994 ₫')).toHaveLength(2);
  expect(within(table).getAllByText('-1 ₫')).toHaveLength(2);
  expect(screen.getByText('Kỳ chưa trọn tháng')).toBeInTheDocument();
  const geometry = JSON.parse(screen.getByTestId('chart').getAttribute('data-geometry')!);
  expect(geometry[0].operatingProfit).toBe(-0.000001);
  expect(geometry[0].exact.revenue).toBe(point.revenue);
  fireEvent.click(screen.getByRole('tab', { name: 'Thu chi thực tế' }));
  const cash = screen.getByRole('table', { name: 'Số liệu xu hướng thu chi chính xác' });
  expect(within(cash).getAllByText('9.007.199.254.740.991 ₫')).toHaveLength(2);
  expect(within(cash).getAllByText('10 ₫')).toHaveLength(2);
  expect(
    screen.getByText(/Chỉ gồm tiền kinh doanh và chi vận hành đã xác nhận/),
  ).toBeInTheDocument();
});
it('keeps unavailable history, empty results and period limits explicit', () => {
  const view = render(<FinancialTrendChart />);
  expect(screen.getByText(/Máy chủ chưa cung cấp dữ liệu xu hướng/)).toBeInTheDocument();
  view.rerender(<FinancialTrendChart points={[]} />);
  expect(screen.getByText('Chưa có dữ liệu xu hướng trong kỳ đã chọn.')).toBeInTheDocument();
  view.rerender(<FinancialTrendChart unavailableReason="period_too_long" />);
  expect(
    screen.getByText('Chọn khoảng không quá 120 tháng để xem xu hướng theo tháng.'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
