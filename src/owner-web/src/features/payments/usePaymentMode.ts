import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import type { PaymentModeView } from '../../../../../packages/client-core/src/payments';
import { usePaymentApi } from './usePaymentApi';

export function usePaymentMode() {
  const api = usePaymentApi();
  const { session } = useAuth();
  return useQuery({
    staleTime: 30_000,
    queryKey: ['sepay-payment-mode', session?.userId],
    queryFn: ({ signal }) =>
      api.request<PaymentModeView>('/api/v1/receiving-bank-accounts/owner/mode', { signal }),
  });
}
