import { useMemo } from 'react';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { createApiClient } from '../../../../../packages/client-core/src/api';
import { apiBaseUrl } from '../../services/config';
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
          apiBaseUrl,
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
          apiBaseUrl,
          () => client.session?.accessToken,
          client.clear,
          client.refresh,
        ),
      ),
    [client],
  );
}
