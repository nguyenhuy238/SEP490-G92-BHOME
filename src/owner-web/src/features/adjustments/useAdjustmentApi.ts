import { useMemo } from 'react';
import { adjustmentClient } from '../../../../../packages/client-core/src/adjustments';
import { useMeterApi } from '../meters/useMeterApi';
export function useAdjustmentApi() {
  const { request } = useMeterApi();
  return useMemo(() => ({ ...adjustmentClient(request), request }), [request]);
}
