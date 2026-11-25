import type { ContractRequest } from './contracts';

export interface HoldingSettings {
  ownerUserId: string;
  holdingMonths: number;
  depositRentMonths: string;
  terms: string;
  version: number;
  updatedAt: string;
  updatedByUserId: string;
}
export interface HoldingPreparation {
  roomId: string;
  locationId: string;
  roomNumber: string;
  settingsVersion: number;
  holdingMonths: number;
  startDate: string;
  endDate: string;
  expiresAt: string;
  monthlyRent: string;
  holdingDeposit: string;
  terms: string;
}
export function holdingSettingsClient(request: ContractRequest) {
  return {
    get: (signal?: AbortSignal) =>
      request<HoldingSettings | null>('/api/v1/contracts/holding-settings', { signal }),
    versions: (signal?: AbortSignal) =>
      request<HoldingSettings[]>('/api/v1/contracts/holding-settings/versions', { signal }),
    save: (input: Pick<HoldingSettings, 'terms'> & { expectedVersion: number }) =>
      request<void>('/api/v1/contracts/holding-settings', {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    prepare: (roomId: string, signal?: AbortSignal) =>
      request<HoldingPreparation>(
        `/api/v1/contracts/holdings/preparation?roomId=${encodeURIComponent(roomId)}`,
        { signal },
      ),
  };
}
