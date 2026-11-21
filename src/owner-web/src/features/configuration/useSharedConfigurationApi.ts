import { useMemo } from 'react';
import { sharedConfigurationClient } from '../../../../../packages/client-core/src/sharedConfiguration';
import { useMeterApi } from '../meters/useMeterApi';

export function useSharedConfigurationApi() {
  const { request } = useMeterApi();
  return useMemo(() => sharedConfigurationClient(request), [request]);
}
