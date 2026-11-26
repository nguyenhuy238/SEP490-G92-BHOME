import { expect, it } from 'vitest';
import { isSePayPaymentCode } from '../../../../packages/client-core/src/payments';

it('accepts issued Test/Live routing codes and retains legacy QR compatibility', () => {
  for (const code of ['BH12345678', 'BHSTG1T0123456789ABCDEF', 'BHPRD1L0123456789ABCDEF']) {
    expect(isSePayPaymentCode(code)).toBe(true);
  }
});
it('rejects truncated, ambiguous and unregistered payment memos', () => {
  for (const code of [
    '',
    '12345678',
    'BHSTG1T0123456789ABCDE',
    'BHSTG1X0123456789ABCDEF',
    'BH12345678 BH12345679',
  ]) {
    expect(isSePayPaymentCode(code)).toBe(false);
  }
});
