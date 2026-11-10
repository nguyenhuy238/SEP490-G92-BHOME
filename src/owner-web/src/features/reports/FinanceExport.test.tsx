import { expect, it } from 'vitest';
import { reportCsv } from '../../services/financeExport';
import type {
  FinancialReport,
  FinanceTotals,
} from '../../../../../packages/client-core/src/finance';
import { formatFinanceMoney } from '../../../../../packages/client-core/src/finance';
it.each([
  ['-999999999999999999', '-999.999.999.999.999.999 ₫'],
  ['-12.5000', '-12,5 ₫'],
  ['-0.00', '0 ₫'],
  ['invalid', '—'],
  ['--100', '—'],
])('formats signed server decimal %s exactly', (value, expected) => {
  expect(formatFinanceMoney(value)).toBe(expected);
});
it('exports exact backend decimals, preserves unavailable values and neutralizes spreadsheet formulas', () => {
  const totals = {
    issued: '999999999999999999',
    approvedAdjustments: '-100',
    netOperatingCashFlow: null,
  } as FinanceTotals;
  const report = {
    filter: { from: '2026-11-01', to: '2026-11-30' },
    snapshotAt: '2026-11-09T00:00:00Z',
    total: totals,
    locations: [{ locationId: 'id', locationName: '=SYNTHETIC()', totals }],
  } as FinancialReport;
  const csv = reportCsv(report);
  expect(csv).toContain('"999999999999999999"');
  expect(csv).toContain('"-100"');
  expect(csv).toContain('"\'=SYNTHETIC()"');
  expect(csv).not.toContain('NaN');
  expect(csv.endsWith(',""')).toBe(true);
});
