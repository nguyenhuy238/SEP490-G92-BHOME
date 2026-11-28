import { expect, it } from 'vitest';
import { emptyIdentity, mergeIdentity } from '../lib/identity';
import type { Proposal } from '../lib/api';

const proposal = (proposedFields: Record<string, string>, warnings: string[] = []): Proposal => ({
  proposedFields,
  warnings,
  confidence: {},
  missingFields: [],
  isFallback: false,
  requiresConfirmation: true,
});
it('keeps the successful accented name when MRZ only corroborates its unaccented spelling', () => {
  const current = { ...emptyIdentity(), fullName: 'NGƯỜI THỬ' };
  const result = mergeIdentity(
    current,
    proposal({ fullName: 'NGUOI THU' }, ['mrz_name_unaccented']),
  );
  expect(result.fields.fullName).toBe('NGƯỜI THỬ');
  expect(result.conflicts).toEqual([]);
});
it('restores accents only from an observed printed name and never guesses them', () => {
  const current = { ...emptyIdentity(), fullName: 'NGUOI THU' };
  expect(
    mergeIdentity(current, proposal({ fullName: 'NGƯỜI THỬ' }), { unaccentedName: true }).fields
      .fullName,
  ).toBe('NGƯỜI THỬ');
  expect(
    mergeIdentity(current, proposal({ fullName: 'TÊN KHÁC' }), { unaccentedName: true }).conflicts,
  ).toEqual(['fullName']);
  expect(mergeIdentity(current, proposal({ fullName: 'NGƯỜI THỬ' })).fields.fullName).toBe(
    'NGUOI THU',
  );
});
it('does not combine names or address continuations from a different observed identity', () => {
  const current = {
    ...emptyIdentity(),
    citizenIdentityNumber: '000000001234',
    fullName: 'NGUOI THU',
    residentialAddress: 'Thôn Mẫu',
  };
  const result = mergeIdentity(
    current,
    proposal({
      citizenIdentityNumber: '000000005678',
      fullName: 'NGƯỜI THỬ',
      residentialAddress: 'Thôn Mẫu Xã Giả Lập',
      dateOfBirth: '2001-03-12',
    }),
    { unaccentedName: true },
  );
  expect(result.fields).toEqual(current);
  expect(result.conflicts).toEqual([
    'citizenIdentityNumber',
    'fullName',
    'dateOfBirth',
    'residentialAddress',
  ]);
  expect(
    mergeIdentity(
      current,
      proposal({
        citizenIdentityNumber: current.citizenIdentityNumber,
        residentialAddress: 'Thôn Mẫu Xã Giả Lập',
      }),
    ).fields.residentialAddress,
  ).toBe('Thôn Mẫu Xã Giả Lập');
});
