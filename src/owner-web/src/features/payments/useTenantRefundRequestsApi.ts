import { useMemo } from 'react';
import { refundPetitionClient } from '../../../../../packages/client-core/src/refunds';
import { useMeterApi } from '../meters/useMeterApi';

export function useTenantRefundRequestsApi() {
  const { request } = useMeterApi();
  return useMemo(() => refundPetitionClient(request), [request]);
}
