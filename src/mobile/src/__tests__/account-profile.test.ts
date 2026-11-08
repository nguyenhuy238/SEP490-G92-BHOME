import { expect, it } from 'vitest';
import { MobileApiError } from '../lib/api';
import {
  contactChanged,
  decodeProfile,
  normalizeProfilePhone,
  profileError,
  validateProfile,
} from '../services/accountProfile';

const profile = {
  userId: 'synthetic',
  fullName: 'Synthetic User',
  phone: null,
  email: null,
  roles: ['Tenant'],
  isActive: true,
  version: 'v1',
};
it('accepts nullable contact fields but rejects incomplete or malformed profile responses', () => {
  expect(decodeProfile(profile)).toEqual(profile);
  for (const bad of [
    null,
    {},
    { ...profile, roles: null },
    { ...profile, isActive: 'true' },
    { ...profile, version: '' },
    { ...profile, phone: 123 },
  ]) {
    expect(() => decodeProfile(bad)).toThrow(MobileApiError);
  }
});
it.each([
  ['', null],
  ['  ', null],
  ['090-123 4567', '0901234567'],
  ['+84 (90).123-4567', '+84901234567'],
  ['12345678', '12345678'],
  ['123456789012345', '123456789012345'],
  ['1234567', undefined],
  ['1234567890123456', undefined],
  ['+123456789012345', '+123456789012345'],
  ['090abc4567', undefined],
  ['０９０１２３４５６７', undefined],
  ['1234567\t8', undefined],
  [' '.repeat(24) + '12345678', undefined],
])('normalizes phone %j using the backend rules', (input, expected) => {
  expect(normalizeProfilePhone(input as string)).toBe(expected);
});
it('validates the backend name/email boundaries without inventing a required email TLD', () => {
  expect(validateProfile({ fullName: 'AB', phone: '', email: 'a@b' })).toEqual({});
  expect(validateProfile({ fullName: 'A', phone: '123', email: 'invalid' })).toHaveProperty(
    'fullName',
  );
  expect(validateProfile({ fullName: 'A'.repeat(151), phone: '', email: 'a@@b' })).toHaveProperty(
    'email',
  );
  expect(
    validateProfile({ fullName: 'AB', phone: '', email: 'a'.repeat(255) + '@b' }),
  ).toHaveProperty('email');
  expect(validateProfile({ fullName: 'AB', phone: '', email: 'a@b\r\n' })).toEqual({}); // sent trimmed
});
it('compares normalized saved contacts to decide whether to sign in again', () => {
  expect(contactChanged({ ...profile, email: 'A@B' }, { ...profile, email: 'a@b' })).toBe(false);
  expect(contactChanged(profile, { ...profile, phone: '12345678' })).toBe(true);
});
it.each(['stale_profile_version', 'email_already_used', 'phone_already_used'])(
  'provides a localized actionable message for %s',
  (code) => {
    expect(profileError(new MobileApiError(409, code))).not.toContain(code);
    expect(profileError(new MobileApiError(409, code)).length).toBeGreaterThan(20);
  },
);
