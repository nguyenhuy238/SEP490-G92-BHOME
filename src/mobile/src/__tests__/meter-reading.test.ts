import { expect, it } from 'vitest';
import {
  estimatedConsumption,
  normalizedReading,
  readingDecreased,
  readingError,
} from '../features/workspace/meterReading';

it('validates empty, negative, malformed and meter-specific precision without rounding', () => {
  for (const value of ['', '-1', '1e3', '1.2.3', '100000000000000'])
    expect(readingError(value, 4)).not.toBe('');
  expect(readingError('1.201', 2)).not.toBe('');
  expect(readingError('1.2000', 2)).toBe('');
  expect(readingError(' 123,45 ', 2)).toBe('');
  expect(normalizedReading(' 123,45 ')).toBe('123.45');
});
it('calculates only valid nonnegative estimates at full numeric(18,4) precision', () => {
  expect(estimatedConsumption('99999999999999.9999', '99999999999999.9998')).toBe('0.0001');
  expect(estimatedConsumption('123.45', '100.1')).toBe('23.35');
  expect(estimatedConsumption('100', '100')).toBe('0');
  expect(estimatedConsumption('10', null)).toBeNull();
  expect(estimatedConsumption('bad', '2')).toBeNull();
  expect(estimatedConsumption('1', '2')).toBeNull();
  expect(readingDecreased('1', '2')).toBe(true);
});
