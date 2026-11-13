import type { ContractRequest } from './contracts';

export interface HoldingSandboxState {
  mode: 'Test';
  contractId: string;
  ownerSimulated: boolean;
  tenantSimulated: boolean;
  canShowQr: boolean;
  depositVerified: boolean;
  required: string;
  verified: string;
  onHold: boolean;
  contractStatus: string;
}
export interface HoldingSandboxQr {
  mode: 'Test';
  contractId: string;
  availability: string;
  accountHolder: string;
  bankIdentifier: string;
  accountNumber: string;
  outstandingAmount: string;
  transferReference: string;
  qrImageDataUri: string | null;
}
export function holdingSandboxClient(request: ContractRequest, id: string) {
  const root = `/api/v1/integrations/sepay/testing/holdings/${encodeURIComponent(id)}`;
  return {
    status: (signal?: AbortSignal) =>
      request<HoldingSandboxState>(`${root}/simulation`, { signal }),
    simulate: (participant: 'Owner' | 'Tenant') =>
      request<HoldingSandboxState>(`${root}/simulation/signatures`, {
        method: 'POST',
        body: JSON.stringify({ participant, simulationOnly: true }),
      }),
    qr: (signal?: AbortSignal) =>
      request<HoldingSandboxQr>(`${root}/transfer-instructions`, { signal }),
    activate: () => request<HoldingSandboxState>(`${root}/simulation/activate`, { method: 'POST' }),
  };
}
