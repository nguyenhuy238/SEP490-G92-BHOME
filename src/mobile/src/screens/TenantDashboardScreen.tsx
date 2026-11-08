import React, { useCallback } from 'react';
import { queryPolicies } from '../lib/queryPolicies';
import { useWorkspaceHeaderRefresh } from '../components/WorkspaceHeaderContext';
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
    allowed ? '/api/v1/contracts?page=1&pageSize=20&status=Active' : null,
    { cache: queryPolicies.contracts },
  );
  const month = new Date()
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    .slice(0, 7);
  const debts = useWorkspaceQuery<Page<DebtInvoice>>(
    allowed ? '/api/v1/debts?page=1&pageSize=1' : null,
    { cache: queryPolicies.debts },
  );
  const debt = debts.data?.items[0];
  const invoices = useWorkspaceQuery<Page<Invoice>>(
    allowed && !debts.loading && !debt ? '/api/v1/invoices?page=1&pageSize=20' : null,
    { cache: queryPolicies.invoices },
  );
  const debtInvoice = useWorkspaceQuery<Invoice>(
    allowed && debt ? `/api/v1/invoices/${encodeURIComponent(debt.invoiceId)}` : null,
    { cache: queryPolicies.invoices },
  );
  const invoice = debt
    ? (debtInvoice.data ?? undefined)
    : invoices.data?.items.find((item) => item.billingPeriod.slice(0, 7) === month);
  const notices = useWorkspaceQuery<Page<NotificationItem>>(
    allowed ? '/api/v1/notifications?page=1&pageSize=3&unread=true' : null,
    { cache: queryPolicies.notifications },
  );
  const expiry = useWorkspaceQuery<ContractExpiryNotice[]>(
    allowed ? '/api/v1/contracts/expiry-reminders' : null,
    { cache: queryPolicies.contracts },
  );
  const payment = useWorkspaceQuery<InvoicePayment>(
    allowed && invoice?.status === 'Final'
      ? `/api/v1/invoices/${encodeURIComponent(invoice.id)}/payment`
      : null,
    { cache: queryPolicies.payments },
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
  useWorkspaceHeaderRefresh(
    reload,
    [contracts, invoices, debts, debtInvoice, notices, expiry, payment].some(
      (query) => query.fetching,
    ),
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
        updatedAt: debts.updatedAt || notices.updatedAt || expiry.updatedAt,
        fetching: debts.fetching || notices.fetching || expiry.fetching,
        stale: debts.stale || notices.stale || expiry.stale,
        reload,
      }}
    />
  );
}
