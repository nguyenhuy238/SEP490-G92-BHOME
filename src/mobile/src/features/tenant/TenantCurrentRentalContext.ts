import { createContext, useContext } from 'react';
import type { ContractSummary } from '../../../../../packages/client-core/src/contracts';

// Only populated by the server-verified Tenant root gate, never by route params.
export const TenantCurrentRentalContext = createContext<ContractSummary | null>(null);

export function useTenantCurrentRental() {
  return useContext(TenantCurrentRentalContext);
}
