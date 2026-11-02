import { useMemo } from 'react';
import { invoiceClient } from '../../../../../packages/client-core/src/invoices';
import { useMeterApi } from '../meters/useMeterApi';
export function useInvoiceApi() {
  const { request } = useMeterApi();
  return useMemo(() => ({ request, ...invoiceClient(request) }), [request]);
}
