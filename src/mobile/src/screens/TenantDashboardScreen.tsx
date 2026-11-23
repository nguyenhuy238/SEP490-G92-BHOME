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
import { businessToday } from '../../../../packages/client-core/src/contracts';
import type { TenantMeterReadingPage } from '../../../../packages/client-core/src/tenantReadings';
import { loadTenantReadings } from '../features/workspace/tenantFinancialLoads';
import { TenantDashboard } from './TenantDashboard';

// Presentation reads only: reuse the same Tenant endpoints as the existing detail screens.
export function TenantDashboardScreen() {
  const { session } = useSession();
  const allowed = session?.roles.includes('Tenant');
  const contracts = useWorkspaceQuery<ContractPage>(
    allowed ? '/api/v1/contracts?page=1&pageSize=20&status=Active' : null,
    { cache: queryPolicies.contracts },
  );
  const month = businessToday().slice(0, 7);
  const currentContract = contracts.data?.items.find(
    (contract) => contract.status === 'Active' && contract.kind !== 'Holding',
  );
  const roomId = currentContract?.roomId;
  // Resolve the Tenant's active room once before choosing a scoped invoice or
  // the authenticated all-own-records fallback for a completed move-out.
  // Otherwise the initial render sends an unnecessary unscoped request and
  // immediately replaces it with a second room-specific request.
  const contractScopeReady = allowed && (!contracts.loading || !!contracts.data);
  const debts = useWorkspaceQuery<Page<DebtInvoice>>(
    allowed ? '/api/v1/debts?page=1&pageSize=1' : null,
    { cache: queryPolicies.debts },
  );
  const debt = debts.data?.items[0];
  const invoices = useWorkspaceQuery<Page<Invoice>>(
    contractScopeReady
      ? `/api/v1/invoices?page=1&pageSize=20&billingPeriod=${month}-01${roomId ? '&roomId=' + encodeURIComponent(roomId) : ''}`
      : null,
    { cache: queryPolicies.invoices },
  );
  // Debts concern older periods, not necessarily this month's bill. Never
  // replace the current period with the first overdue invoice in the header.
  const invoice = invoices.data?.items.find(
    (item) => item.billingPeriod.slice(0, 7) === month && (!roomId || item.roomId === roomId),
  );
  const readings = useWorkspaceQuery<TenantMeterReadingPage>(
    contractScopeReady
      ? `/api/v1/tenant/meter-readings?page=1&pageSize=20${roomId ? '&roomId=' + encodeURIComponent(roomId) : ''}`
      : null,
    { load: loadTenantReadings, cache: queryPolicies.meters },
  );
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
    reloadReadings = readings.reload,
    reloadNotices = notices.reload,
    reloadExpiry = expiry.reload,
    reloadPayment = payment.reload;
  const reload = useCallback(() => {
    reloadContracts();
    reloadInvoices();
    reloadDebts();
    reloadReadings();
    reloadNotices();
    reloadExpiry();
    reloadPayment();
  }, [
    reloadContracts,
    reloadInvoices,
    reloadDebts,
    reloadReadings,
    reloadNotices,
    reloadExpiry,
    reloadPayment,
  ]);
  useWorkspaceHeaderRefresh(
    reload,
    [contracts, invoices, debts, readings, notices, expiry, payment].some(
      (query) => query.fetching,
    ),
  );
  return (
    <TenantDashboard
      contracts={contracts.data?.items}
      month={month}
      invoice={invoice}
      meterReadings={readings.data?.items}
      meterState={readings}
      payment={payment.data ?? undefined}
      contractState={contracts}
      invoiceState={invoices}
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
