import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { createApiClient } from '../../../../../packages/client-core/src/api';
import { getApiBaseUrl } from '../../../../../packages/client-core/src/config';
import {
  contractClient,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import { mainDraftClient } from '../../../../../packages/client-core/src/mainDrafts';
import {
  signingClient,
  type SigningMethods,
} from '../../../../../packages/client-core/src/signing';

export function useContractsApi() {
  const { client } = useAuth();
  return useMemo(
    () =>
      contractClient(
        createApiClient(
          getApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.DEV),
          () => client.session?.accessToken,
          client.clear,
          client.refresh,
        ),
      ),
    [client],
  );
}

// Digital signing over the same authenticated transport as the contract client it is given.
export function useSigningApi(api: ContractClient) {
  return useMemo(() => signingClient(api.transport), [api]);
}

/** What GET /contracts/signing-methods offers the Owner; null while loading, on older servers or in tests. */
export function useSigningMethods(api: ContractClient): SigningMethods | null {
  const signing = useSigningApi(api);
  const enabled = typeof api.transport === 'function';
  const query = useQuery({
    queryKey: ['contract-signing-methods'],
    enabled,
    retry: false,
    // Older servers (and test doubles) answer without a method list: treat as "not offered".
    queryFn: async ({ signal }) => {
      const data = await signing.methods(signal);
      return Array.isArray(data?.methods) ? data : null;
    },
  });
  return enabled ? (query.data ?? null) : null;
}

export function useMainDraftApi() {
  const { client } = useAuth();
  return useMemo(
    () =>
      mainDraftClient(
        createApiClient(
          getApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.DEV),
          () => client.session?.accessToken,
          client.clear,
          client.refresh,
        ),
      ),
    [client],
  );
}
