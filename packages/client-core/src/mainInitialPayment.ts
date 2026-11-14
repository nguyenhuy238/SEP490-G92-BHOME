import type { ContractRequest } from './contracts';
export interface MainInitialPayment {
  contractId: string;
  availability: string;
  signingComplete: boolean;
  charges: { code: string; name: string; amount: string }[];
  requiredDeposit: string;
  holdingCredit: string;
  verifiedDeposit: string;
  verifiedRentAndFees: string;
  outstandingAmount: string;
  paid: boolean;
  transferReference: string | null;
  bankIdentifier: string | null;
  accountNumber: string | null;
  accountHolder: string | null;
  qrImageDataUri: string | null;
  isDevelopmentDemo: boolean;
}
export function mainInitialPaymentClient(request: ContractRequest, id: string) {
  const root = `/api/v1/contracts/${encodeURIComponent(id)}/initial-payment`;
  return {
    status: (signal?: AbortSignal) => request<MainInitialPayment>(root, { signal }),
    qr: (signal?: AbortSignal) =>
      request<MainInitialPayment>(root + '/transfer-instructions', { method: 'POST', signal }),
  };
}
