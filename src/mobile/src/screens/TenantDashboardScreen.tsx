import React, { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useSession } from '../lib/SessionProvider';
import type {
  ContractPage,
  ContractExpiryNotice,
} from '../../../../packages/client-core/src/contracts';
import type { Invoice, Page } from '../../../../packages/client-core/src/invoices';
import type { InvoicePayment, DebtInvoice } from '../../../../packages/client-core/src/payments';
import type { NotificationItem } from '../../../../packages/client-core/src/notifications';
import { TenantDashboard } from './TenantDashboard';

// Presentation reads only: reuse the same Tenant endpoints as the existing detail screens.
export function TenantDashboardScreen() {
  const { session } = useSession();
  const allowed = session?.roles.includes('Tenant');
  const contracts = useWorkspaceQuery<ContractPage>(
    allowed ? '/api/v1/contracts?page=1&pageSize=5&status=Active' : null,
  );
  const invoices = useWorkspaceQuery<Page<Invoice>>(
    allowed ? '/api/v1/invoices?page=1&pageSize=20' : null,
  );
  const month = new Date()
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    .slice(0, 7);
  const debts = useWorkspaceQuery<Page<DebtInvoice>>(
    allowed ? '/api/v1/debts?page=1&pageSize=1' : null,
  );
  const debt = debts.data?.items[0];
  const debtInvoice = useWorkspaceQuery<Invoice>(
    allowed && debt ? `/api/v1/invoices/${encodeURIComponent(debt.invoiceId)}` : null,
  );
  const invoice = debt
    ? (debtInvoice.data ?? undefined)
    : invoices.data?.items.find((item) => item.billingPeriod.slice(0, 7) === month);
  const notices = useWorkspaceQuery<Page<NotificationItem>>(
    allowed ? '/api/v1/notifications?page=1&pageSize=3&unread=true' : null,
  );
  const expiry = useWorkspaceQuery<ContractExpiryNotice[]>(
    allowed ? '/api/v1/contracts/expiry-reminders' : null,
  );
  const payment = useWorkspaceQuery<InvoicePayment>(
    allowed && invoice?.status === 'Final'
      ? `/api/v1/invoices/${encodeURIComponent(invoice.id)}/payment`
      : null,
  );
  const reloadContracts = contracts.reload,
    reloadInvoices = invoices.reload,
    reloadDebts = debts.reload,
    reloadDebtInvoice = debtInvoice.reload,
    reloadNotices = notices.reload,
    reloadExpiry = expiry.reload,
    reloadPayment = payment.reload;
  const reload = useCallback(() => {
    reloadContracts();
    reloadInvoices();
    reloadDebts();
    reloadDebtInvoice();
    reloadNotices();
    reloadExpiry();
    reloadPayment();
  }, [
    reloadContracts,
    reloadInvoices,
    reloadDebts,
    reloadDebtInvoice,
    reloadNotices,
    reloadExpiry,
    reloadPayment,
  ]);
  useFocusEffect(
    useCallback(() => {
      if (allowed) reload();
    }, [allowed, reload]),
  );
  return (
    <TenantDashboard
      contracts={contracts.data?.items}
      invoice={invoice}
      payment={payment.data ?? undefined}
      contractState={contracts}
      invoiceState={debt ? debtInvoice : invoices}
      paymentState={payment}
      debt={debt}
      notices={notices.data?.items}
      expiryNotices={Array.isArray(expiry.data) ? expiry.data : []}
      alertsState={{
        loading: debts.loading || notices.loading || expiry.loading,
        error: debts.error || notices.error || expiry.error,
        reload,
      }}
      reload={reload}
    />
  );
}
