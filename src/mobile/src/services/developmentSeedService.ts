import type { MobileApi } from '../lib/api';

export interface DevelopmentOnboardingSeedResult {
  contractId: string;
  roomId: string;
  roomNumber: string;
  locationName: string;
  tenantEmail: string;
  tenantPassword: string;
  tenantName: string;
  initialMeterTasks: number;
  developmentOnly: boolean;
}

// This request is available only for an authenticated Staff session against a local
// Development database. A stable key allows safe retries after an uncertain response.
export function seedDevelopmentContract(api: MobileApi, locationId: string, key: string) {
  return api.request<DevelopmentOnboardingSeedResult>('/api/v1/development/onboarding-seed', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ locationId }),
  });
}
