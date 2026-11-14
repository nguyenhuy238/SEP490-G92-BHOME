import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { InvoicePayment } from '../../../../../packages/client-core/src/payments';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';
import { loadInvoicePayment } from '../../services/tenantInvoices';
import { queryPolicies } from '../../lib/queryPolicies';
import { useSession } from '../../lib/SessionProvider';
import { showToast } from '../../lib/toast';

export function useTenantInvoicePayment(invoiceId?: string | null) {
  const query = useWorkspaceQuery<InvoicePayment>(
    invoiceId ? `/api/v1/invoices/${encodeURIComponent(invoiceId)}/payment` : null,
    { load: loadInvoicePayment, notifyError: false, cache: queryPolicies.payments },
  );
  const { api } = useSession();
  const { reload, revalidate } = query;
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);
  // Callers use reload in their focus callback; keep it stable when the query is enabled.
  const refresh = useCallback(() => reloadRef.current(), []);
  const latest = useRef({ data: query.data, fetching: query.fetching });
  const previous = useRef<{
    api: typeof api;
    invoiceId: typeof invoiceId;
    signature: string;
  } | null>(null);
  useEffect(() => {
    latest.current = { data: query.data, fetching: query.fetching };
    if (!query.data) return;
    const signature = JSON.stringify([
      query.data.paymentStatus,
      query.data.paidAmount,
      query.data.outstandingAmount,
    ]);
    if (
      previous.current?.api === api &&
      previous.current.invoiceId === invoiceId &&
      previous.current.signature !== signature
    )
      showToast('info', 'Trạng thái thanh toán đã được cập nhật.');
    previous.current = { api, invoiceId, signature };
  }, [api, invoiceId, query.data, query.fetching]);
  useFocusEffect(
    useCallback(() => {
      if (!invoiceId) return;
      let timer: ReturnType<typeof setInterval> | undefined;
      const stop = () => clearInterval(timer);
      const start = () => {
        stop();
        reload(); // Session cache coalesces concurrent consumers and focus refreshes.
        const deadline = Date.now() + 5 * 60_000;
        timer = setInterval(() => {
          if (Date.now() >= deadline || latest.current.data?.paymentStatus !== 'Unpaid') {
            stop();
            return;
          }
          if (!latest.current.fetching) revalidate();
        }, 30_000);
      };
      if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') start();
      const listener = AppState.addEventListener('change', (state) => {
        if (state === 'active') start();
        else stop();
      });
      return () => {
        stop();
        listener.remove();
      };
    }, [invoiceId, reload, revalidate]),
  );
  return { ...query, reload: refresh };
}
