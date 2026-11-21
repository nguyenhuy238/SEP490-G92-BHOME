import type { Scenario } from '../types/portal';
export const baselineScenario: Scenario = {
  id: '',
  name: 'Kịch bản A: Tăng giá mùa cao điểm',
  occupancy: 95,
  priceDelta: 5,
  staffCost: 20250000,
  maintenanceDelta: 10,
  serviceFee: false,
  expansion: false,
};
export function projectScenario(
  baseRevenue: number,
  baseExpenses: number,
  baseOccupancy: number,
  rooms: number,
  scenario: Scenario,
) {
  const revenue = Math.round(
    (baseRevenue / Math.max(1, baseOccupancy)) *
      scenario.occupancy *
      (1 + scenario.priceDelta / 100) +
      (scenario.serviceFee ? rooms * 30000 : 0),
  );
  const expenses = Math.round(
    baseExpenses + scenario.staffCost - 20250000 + (1800000 * scenario.maintenanceDelta) / 100,
  );
  const profit = revenue - expenses;
  const capital = 1200000000 + (scenario.expansion ? 1200000000 : 0);
  return { revenue, expenses, profit, capital, payback: profit > 0 ? capital / profit : null };
}
