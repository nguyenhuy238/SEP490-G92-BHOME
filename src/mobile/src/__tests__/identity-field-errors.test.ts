import { expect, it } from 'vitest';
import { identityFieldErrors } from '../features/onboarding/identityFieldErrors';
import { confirmedIdentity, emptyIdentity } from '../lib/identity';

it('matches existing identity validation for required, optional and calendar values', () => {
  const valid = {
    ...emptyIdentity(),
    citizenIdentityNumber: '000000000001',
    fullName: 'MẪU',
    dateOfBirth: '29/02/2000',
  };
  for (const fields of [
    valid,
    emptyIdentity(),
    { ...valid, dateOfBirth: '29/02/2001' },
    { ...valid, dateOfIssue: '31/04/2020' },
    { ...valid, dateOfExpiry: ' ' },
    { ...valid, citizenIdentityNumber: ' 000000000001 ', fullName: ' MẪU ' },
    { ...valid, dateOfExpiry: '01/01/2030' },
  ]) {
    if (Object.keys(identityFieldErrors(fields)).length)
      expect(() => confirmedIdentity(fields)).toThrow();
    else expect(() => confirmedIdentity(fields)).not.toThrow();
  }
});
