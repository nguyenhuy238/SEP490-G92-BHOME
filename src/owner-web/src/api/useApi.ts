import { useMemo } from 'react';
import { createApiClient } from '@bhome/client-core/api.ts';
import { useAuth } from '@bhome/client-core/auth.tsx';
import { apiBaseUrl } from './config';

export function useApi() {
  const { session, clearSession } = useAuth();
  return useMemo(
    () => createApiClient(apiBaseUrl, () => session?.accessToken, clearSession),
    [session, clearSession],
  );
}
