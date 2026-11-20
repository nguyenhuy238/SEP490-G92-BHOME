import type { ContractRequest } from './contracts';
export interface HouseholdMember {
  residentId?: string;
  clientKey: string;
  fullName: string;
  dateOfBirth: string;
  relationship: string;
  phone?: string | null;
  citizenNumber?: string | null;
}
export interface HouseholdView {
  representativeResidentId: string;
  version: number;
  draftId?: string | null;
  representative?: {
    fullName: string;
    dateOfBirth: string;
    phone?: string | null;
    maskedCitizenNumber?: string | null;
  } | null;
  members: (HouseholdMember & { residentId: string })[];
}
export function householdClient(request: ContractRequest) {
  return {
    get: (id: string, signal?: AbortSignal) =>
      request<HouseholdView>(`/api/v1/capture/residents/${encodeURIComponent(id)}/household`, {
        signal,
      }),
    save: (id: string, members: HouseholdMember[], expectedVersion: number, key: string) =>
      request<HouseholdView>(`/api/v1/capture/residents/${encodeURIComponent(id)}/household`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ expectedVersion, humanConfirmed: true, members }),
      }),
    contract: (id: string, signal?: AbortSignal) =>
      request<HouseholdView>(`/api/v1/contracts/${encodeURIComponent(id)}/household`, { signal }),
  };
}
