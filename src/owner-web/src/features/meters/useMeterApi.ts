import { useMemo } from 'react';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { createApiClient } from '../../../../../packages/client-core/src/api';
import { apiBaseUrl } from '../../services/config';
import { meterClient } from '../../../../../packages/client-core/src/meter';

export function useMeterApi() {
  const { client } = useAuth();
  return useMemo(() => {
    const request = createApiClient(
      apiBaseUrl,
      () => client.session?.accessToken,
      client.clear,
      client.refresh,
    );
    return { request, ...meterClient(request) };
  }, [client]);
}
