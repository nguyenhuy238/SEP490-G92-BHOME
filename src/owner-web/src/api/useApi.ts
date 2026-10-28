import { useMemo } from 'react';
import { createApiClient } from '@bhome/client-core/api.ts';
import { useAuth } from '@bhome/client-core/auth.tsx';
import { apiBaseUrl } from './config';

export function useApi() {
  const { client, clearSession } = useAuth();
  return useMemo(
    () => createApiClient(apiBaseUrl, () => client.token, clearSession, client.refresh),
    [client, clearSession],
  );
}
