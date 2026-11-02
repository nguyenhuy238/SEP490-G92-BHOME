import { useMemo } from 'react';
import { paymentClient } from '../../../../../packages/client-core/src/payments';
import { useMeterApi } from '../meters/useMeterApi';
export function usePaymentApi() {
  const { request } = useMeterApi();
  return useMemo(() => ({ ...paymentClient(request), request }), [request]);
}
