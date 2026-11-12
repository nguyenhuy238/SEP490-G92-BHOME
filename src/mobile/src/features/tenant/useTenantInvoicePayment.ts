import { useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { InvoicePayment } from '../../../../../packages/client-core/src/payments';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';
import { loadInvoicePayment } from '../../services/tenantInvoices';

export function useTenantInvoicePayment(invoiceId?: string | null) {
  const query = useWorkspaceQuery<InvoicePayment>(
    invoiceId ? `/api/v1/invoices/${encodeURIComponent(invoiceId)}/payment` : null,
    { load: loadInvoicePayment, notifyError: false },
  );
  const { reload } = query;
  const visited = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!invoiceId) return;
      if (visited.current) reload();
      visited.current = true;
      const timer = setInterval(() => {
        if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive')
          reload();
      }, 30000);
      return () => clearInterval(timer);
    }, [invoiceId, reload]),
  );
  return query;
}
