import { expect, it } from 'vitest';
import { formatBillingDecimal } from '../../../packages/client-core/src/invoices';

it('formats exact decimal billing strings without floating point loss or trailing storage zeros', () => {
  expect(formatBillingDecimal('3500.0000')).toBe('3.500');
  expect(formatBillingDecimal('25.5000')).toBe('25,5');
  expect(formatBillingDecimal('99999999999999.9999')).toBe('99.999.999.999.999,9999');
  expect(formatBillingDecimal('0.0001')).toBe('0,0001');
  expect(formatBillingDecimal('NaN')).toBe('—');
});
