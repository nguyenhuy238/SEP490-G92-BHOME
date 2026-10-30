import { useMemo } from 'react';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { createApiClient } from '../../../../../packages/client-core/src/api';
import { getApiBaseUrl } from '../../../../../packages/client-core/src/config';
import { contractClient } from '../../../../../packages/client-core/src/contracts';

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
