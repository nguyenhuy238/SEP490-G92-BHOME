import { useMemo } from 'react';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { createApiClient } from '../../../../../packages/client-core/src/api';
import { getApiBaseUrl } from '../../../../../packages/client-core/src/config';
import {
  contractClient,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import { mainDraftClient } from '../../../../../packages/client-core/src/mainDrafts';
import { signingClient } from '../../../../../packages/client-core/src/signing';

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
