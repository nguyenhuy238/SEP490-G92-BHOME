import { useMemo } from 'react';
import { propertySetupClient } from '../../../../../packages/client-core/src/propertySetup';
import { useMeterApi } from '../meters/useMeterApi';

export function usePropertySetupApi() {
  const { request } = useMeterApi();
  return useMemo(() => propertySetupClient(request), [request]);
}
