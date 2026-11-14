import type { ContractRequest } from './contracts';

export interface HoldingSettings {
  locationId: string;
  holdingMonths: number;
  depositRentMonths: string;
  terms: string;
  version: number;
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
    get: (locationId: string, signal?: AbortSignal) =>
      request<HoldingSettings | null>(`/api/v1/contracts/holding-settings/${locationId}`, {
        signal,
      }),
    save: (
      locationId: string,
      input: Omit<HoldingSettings, 'locationId' | 'version'> & { expectedVersion: number },
    ) =>
      request<void>(`/api/v1/contracts/holding-settings/${locationId}`, {
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
