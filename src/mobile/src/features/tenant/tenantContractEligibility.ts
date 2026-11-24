import type { ContractSummary } from '../../../../../packages/client-core/src/contracts';

/** Only a currently active room rental grants access to Tenant features. */
export function isActiveRoomRental(contract: Pick<ContractSummary, 'status' | 'kind' | 'roomId'>) {
  return (
    contract.status === 'Active' &&
    (contract.kind === 'Main' || contract.kind === 'Renewal') &&
    !!contract.roomId
  );
}
