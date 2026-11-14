import { expect, it } from 'vitest';
import {
  contactPhoneError,
  normalizeContactPhone,
} from '../../../../packages/client-core/src/contactPhone';

it.each([
  ['0912 345 678', '+84912345678'],
  ['+84 (912) 345-678', '+84912345678'],
  ['024 1234 5678', '+842412345678'],
  ['+1 202 555 0100', '+12025550100'],
])('normalizes %s to its canonical contact number', (value, expected) => {
  expect(normalizeContactPhone(value)).toBe(expected);
  expect(contactPhoneError(value)).toBe('');
});

it.each([
  '1234567890',
  '09000000000',
  '+840912345678',
  '0912ABC678',
  '+0123456789',
  '+849123456789',
])('rejects invalid phone %s', (value) => {
  expect(normalizeContactPhone(value)).toBeUndefined();
  expect(contactPhoneError(value)).not.toBe('');
});

it('allows blank only when the field is optional', () => {
  expect(contactPhoneError('')).toBe('');
  expect(contactPhoneError('', true)).not.toBe('');
});
