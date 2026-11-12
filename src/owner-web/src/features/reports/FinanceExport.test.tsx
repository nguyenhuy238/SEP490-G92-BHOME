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
  const report: FinancialReport = {
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
it('exports settlement sources without converting decimal strings to JavaScript numbers', () => {
  const report = {
    filter: { from: '2026-11-01', to: '2026-11-30' },
    snapshotAt: '2026-11-11T00:00:00Z',
    total: {
      issued: '9007199254740993',
      approvedAdjustments: '0',
      verifiedCollections: '0',
      operatingExpenses: '0',
      operatingProfit: '9007199254740993',
      outstandingNow: '200000',
      initialInvestment: '0',
      netOperatingCashFlow: '0',
      totalRooms: 1,
      occupiedRooms: 0,
    },
    locations: [],
    capital: {
      initialInvestment: '0',
      netRecovery: null,
      remainingCapital: null,
      recoveryPercent: null,
      estimatedRemainingMonths: null,
      unavailableReason: 'initial_investment_required',
    },
    hasUnclassifiedRefunds: false,
    settlementSources: {
      approvedCharges: '9007199254740993',
      outstandingNow: '200000',
      verifiedBankCollections: '0',
      depositOffsetsApplied: '400000',
      holdingForfeitures: '100000',
    },
  };
  const csv = reportCsv(report);
  expect(csv).toContain('"settlementApprovedCharges"');
  expect(csv).toContain('"9007199254740993","200000","0","400000","100000"');
});
