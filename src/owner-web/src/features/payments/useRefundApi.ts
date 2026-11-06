import { useMemo } from 'react';
import { refundClient } from '../../../../../packages/client-core/src/refunds';
import { useMeterApi } from '../meters/useMeterApi';
export function useRefundApi() {
  const { request } = useMeterApi();
  return useMemo(() => refundClient(request), [request]);
}
