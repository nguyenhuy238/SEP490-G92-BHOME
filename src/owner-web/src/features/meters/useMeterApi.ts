import { useMemo } from 'react';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { createApiClient } from '../../../../../packages/client-core/src/api';
import { getApiBaseUrl } from '../../../../../packages/client-core/src/config';
import { meterClient } from '../../../../../packages/client-core/src/meter';

export function useMeterApi() {
  const { client } = useAuth();
  return useMemo(() => {
    const request = createApiClient(
      getApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.DEV),
      () => client.session?.accessToken,
      client.clear,
      client.refresh,
    );
    return { request, ...meterClient(request) };
  }, [client]);
}
