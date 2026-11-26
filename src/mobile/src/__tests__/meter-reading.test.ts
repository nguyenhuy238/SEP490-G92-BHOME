import { expect, it } from 'vitest';
import {
  estimatedConsumption,
  integerReadingInput,
  normalizedReading,
  readingDecreased,
  readingError,
} from '../features/workspace/meterReading';

it('accepts only nonnegative integer input without rounding', () => {
  for (const value of ['', '-1', '1e3', '1.2.3', '100000000000000', '14.5', '14,5', '15 3', '14.0'])
    expect(readingError(value)).not.toBe('');
  for (const value of ['0', '14', '153', '99999999999999']) expect(readingError(value)).toBe('');
  expect(integerReadingInput('14.0000')).toBe('14');
  expect(integerReadingInput('14.25')).toBe('14.25');
  expect(normalizedReading(' 123,45 ')).toBe('123.45');
  expect(readingError('12.')).toBe('Chỉ số phải là số nguyên không âm.');
  expect(readingError('100000000000000')).toBe('Chỉ số không được vượt quá 14 chữ số.');
  expect(readingError('')).toBe('Vui lòng nhập chỉ số.');
});
it('calculates only valid nonnegative estimates at full numeric(18,4) precision', () => {
  expect(estimatedConsumption('99999999999999.9999', '99999999999999.9998')).toBe('0.0001');
  expect(estimatedConsumption('123.45', '100.1')).toBe('23.35');
  expect(estimatedConsumption('125', '100.1')).toBe('24.9');
  expect(estimatedConsumption('100', '100')).toBe('0');
  expect(estimatedConsumption('10', null)).toBeNull();
  expect(estimatedConsumption('bad', '2')).toBeNull();
  expect(estimatedConsumption('1', '2')).toBeNull();
  expect(readingDecreased('1', '2')).toBe(true);
});
