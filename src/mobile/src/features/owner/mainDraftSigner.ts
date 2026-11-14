import type { MainDraftView } from '../../../../../packages/client-core/src/mainDrafts';

// Existing Owner-only GET /api/v1/residents/{id}; deliberately omit deep identity fields.
export interface MainDraftSigner {
  id: string;
  roomId: string | null;
  residentType: string;
  verificationStatus: string;
  tenantUserId: string | null;
  contactEmail: string | null;
  account?: { isActive: boolean } | null;
}

export function verifiedDraftSigner(draft: MainDraftView, resident: MainDraftSigner) {
  const { input, preparation } = draft;
  const representative = preparation.residents.find(
    (person) => person.id === input.representativeResidentId,
  );
  if (
    resident.id !== input.representativeResidentId ||
    resident.roomId !== input.roomId ||
    resident.residentType !== 'Representative' ||
    resident.verificationStatus !== 'Verified' ||
    !representative?.representative ||
    preparation.residents.filter((person) => person.representative).length !== 1 ||
    !input.residentIds.includes(resident.id) ||
    preparation.residents.length !== input.residentIds.length ||
    preparation.residents.some((person) => !input.residentIds.includes(person.id))
  )
    throw { code: 'verified_contract_signer_required' };
  if (resident.tenantUserId && resident.account?.isActive === false)
    throw { code: 'verified_tenant_account_required' };
  if (!resident.tenantUserId && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resident.contactEmail ?? ''))
    throw { code: 'verified_residents_with_email_required' };
  return resident;
}
