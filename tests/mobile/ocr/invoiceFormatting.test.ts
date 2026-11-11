import { expect, it, vi } from 'vitest';
import {
  formatBillingDecimal,
  hasSettlementUsageCoverage,
  type InvoiceLine,
} from '../../../packages/client-core/src/invoices';
import { formatDraftMoney } from '../../../packages/client-core/src/mainDrafts';
import { formatContractMoney } from '../../../packages/client-core/src/contracts';

it('formats exact decimal billing strings without floating point loss or trailing storage zeros', () => {
  expect(formatBillingDecimal('3500.0000')).toBe('3.500');
  expect(formatBillingDecimal('25.5000')).toBe('25,5');
  expect(formatBillingDecimal('99999999999999.9999')).toBe('99.999.999.999.999,9999');
  expect(formatBillingDecimal('0.0001')).toBe('0,0001');
  expect(formatBillingDecimal('NaN')).toBe('—');
});
it('labels only an explicit zero-amount usage coverage record as already charged elsewhere', () => {
  const line = {
    amount: '0',
    utilityCalculationSnapshot: JSON.stringify({ kind: 'CoveredBySettlement/v1' }),
  } as InvoiceLine;
  expect(hasSettlementUsageCoverage(line)).toBe(true);
  expect(hasSettlementUsageCoverage({ ...line, amount: '100' })).toBe(false);
  expect(hasSettlementUsageCoverage({ ...line, utilityCalculationSnapshot: '{invalid' })).toBe(
    false,
  );
  expect(hasSettlementUsageCoverage({ ...line, utilityCalculationSnapshot: null })).toBe(false);
});

it('formats contract and billing amounts when native Intl rejects BigInt', () => {
  const intl = vi.spyOn(Intl, 'NumberFormat').mockImplementation(function () {
    return {
      format(value: number | bigint) {
        if (typeof value === 'bigint') throw new TypeError('Cannot convert BigInt to number');
        return String(value);
      },
    } as Intl.NumberFormat;
  });
  try {
    expect(formatDraftMoney('3000000.0000')).toBe('3.000.000 ₫');
    expect(formatDraftMoney('3500.0000')).toBe('3.500 ₫');
    expect(formatBillingDecimal('999999999999999999.9999')).toBe('999.999.999.999.999.999,9999');
    expect(formatContractMoney('999999999999999999')).toBe('999.999.999.999.999.999\u00a0₫');
    expect(formatContractMoney('0003000000')).toBe('3.000.000\u00a0₫');
    expect(formatContractMoney('999999999999999999.0000')).toBe('999.999.999.999.999.999\u00a0₫');
    expect(formatContractMoney('1.25')).toBe('—');
    expect(formatBillingDecimal('0000.0000')).toBe('0');
    expect(formatContractMoney('invalid')).toBe('—');
    expect(formatDraftMoney('NaN')).toBe('—');
  } finally {
    intl.mockRestore();
  }
});
