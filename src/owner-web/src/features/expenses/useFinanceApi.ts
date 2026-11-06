import { useMemo } from 'react';
import { financeClient } from '../../../../../packages/client-core/src/finance';
import { useMeterApi } from '../meters/useMeterApi';
export function useFinanceApi() {
  const { request } = useMeterApi();
  return useMemo(() => financeClient(request), [request]);
}
