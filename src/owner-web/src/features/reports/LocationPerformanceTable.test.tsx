import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type {
  FinancialReport,
  FinanceTotals,
} from '../../../../../packages/client-core/src/finance';
import { LocationPerformanceTable } from './LocationPerformanceTable';
import { compareDecimal } from '../finance/compareDecimal';

it('compares signed decimal strings without losing integer precision', () => {
  expect(compareDecimal('9007199254740993', '9007199254740992')).toBe(1);
  expect(compareDecimal('-2.1', '-2.09')).toBe(-1);
  expect(compareDecimal('1.00', '1')).toBe(0);
});
it('sorts server results, filters by name, and keeps the authoritative chain total', () => {
  const totals = (profit: string, occupancy: string | null) =>
    ({
      totalRooms: 10,
      occupiedRooms: 3,
      operatingExpenses: '100',
      operatingProfit: profit,
      initialInvestment: '1000',
      management: { currentOccupancyPercent: occupancy, revenue: '200' },
    }) as FinanceTotals;
  const report = {
    total: totals('9007199254740993', '70'),
    locations: [
      { locationId: 'a', locationName: 'Alpha', totals: totals('9007199254740992', null) },
      { locationId: 'b', locationName: 'Beta', totals: totals('9007199254740993', '20') },
    ],
  } as FinancialReport;
  render(<LocationPerformanceTable report={report} />);
  const table = screen.getByRole('table', { name: 'So sánh hiệu quả cơ sở' });
  expect(within(table).getAllByRole('row')[2]).toHaveTextContent('Beta');
  expect(within(table).getAllByRole('row')[3]).toHaveTextContent('Alpha');
  expect(within(table).getAllByRole('row')[3]).toHaveTextContent('Chưa xác định');
  fireEvent.change(screen.getByLabelText('Tìm cơ sở'), { target: { value: 'Alpha' } });
  expect(within(table).queryByText('Beta')).not.toBeInTheDocument();
  expect(within(table).getAllByRole('row')[1]).toHaveTextContent('70%');
});
