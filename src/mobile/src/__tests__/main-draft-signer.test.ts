import { expect, it } from 'vitest';
import { verifiedDraftSigner, type MainDraftSigner } from '../features/owner/mainDraftSigner';
import type { MainDraftView } from '../../../../packages/client-core/src/mainDrafts';
const draft = {
  input: { roomId: 'room', representativeResidentId: 'a', residentIds: ['a'] },
  preparation: { residents: [{ id: 'a', representative: true }] },
} as MainDraftView;
const resident: MainDraftSigner = {
  id: 'a',
  roomId: 'room',
  residentType: 'Representative',
  verificationStatus: 'Verified',
  tenantUserId: null,
  contactEmail: 'synthetic@example.invalid',
};
it('resolves a verified individual with no account and preserves an existing linked account', () => {
  expect(verifiedDraftSigner(draft, resident).tenantUserId).toBeNull();
  expect(verifiedDraftSigner(draft, { ...resident, tenantUserId: 'linked' }).tenantUserId).toBe(
    'linked',
  );
});
it.each([
  { id: 'b' },
  { roomId: 'other' },
  { verificationStatus: 'Pending' },
  { residentType: 'CoOccupant' },
])('rejects a signer mismatch %j', (change) => {
  expect(() => verifiedDraftSigner(draft, { ...resident, ...change })).toThrow();
});
it('keeps the prepared representative and co-occupants without inferring a household classification', () => {
  const family = {
    ...draft,
    input: { ...draft.input, residentIds: ['a', 'b'] },
    preparation: {
      ...draft.preparation,
      residents: [
        { id: 'a', representative: true },
        { id: 'b', representative: false },
      ],
    },
  } as MainDraftView;
  expect(verifiedDraftSigner(family, resident).id).toBe('a');
  expect(() => verifiedDraftSigner(family, { ...resident, id: 'b' })).toThrow();
});
it('rejects missing confirmed contact for internal acceptance and an inactive linked account', () => {
  expect(() => verifiedDraftSigner(draft, { ...resident, contactEmail: null })).toThrow();
  expect(() =>
    verifiedDraftSigner(draft, {
      ...resident,
      tenantUserId: 'linked',
      account: { isActive: false },
    }),
  ).toThrow();
});
