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
import { isActiveRoomRental } from '../features/tenant/tenantContractEligibility';
import { useTenantCurrentRental } from '../features/tenant/TenantCurrentRentalContext';
import type { TenantMeterReadingPage } from '../../../../packages/client-core/src/tenantReadings';
import { loadTenantReadings } from '../features/workspace/tenantFinancialLoads';
import { TenantDashboard } from './TenantDashboard';

// Presentation reads only: reuse the same Tenant endpoints as the existing detail screens.
export function TenantDashboardScreen() {
  const verifiedRental = useTenantCurrentRental();
  const { session } = useSession();
  const allowed = session?.roles.includes('Tenant');
  const contracts = useWorkspaceQuery<ContractPage>(
    allowed ? '/api/v1/contracts?page=1&pageSize=100&status=Active' : null,
    { cache: queryPolicies.contracts },
  );
  const month = businessToday().slice(0, 7);
  const currentContract = verifiedRental ?? contracts.data?.items.find(isActiveRoomRental);
  // The root gate checks every Active page. A valid room on page 2+ must not
  // disappear from Home merely because this screen's first 100 rows omit it.
  const visibleContracts = currentContract
    ? [
        currentContract,
        ...(contracts.data?.items.filter((item) => item.id !== currentContract.id) ?? []),
      ]
    : contracts.data?.items;
  const roomId = currentContract?.roomId;
  // A completed move-out must not fall back to unscoped finance endpoints.
  // Global navigation restricts this state too; this protects direct mounts.
  const contractScopeReady = allowed && !!roomId && !contracts.error;
  const debts = useWorkspaceQuery<Page<DebtInvoice>>(
    contractScopeReady ? '/api/v1/debts?page=1&pageSize=1' : null,
    { cache: queryPolicies.debts },
  );
  const debt = debts.data?.items[0];
  const invoices = useWorkspaceQuery<Page<Invoice>>(
    contractScopeReady
      ? `/api/v1/invoices?page=1&pageSize=20&billingPeriod=${month}-01&roomId=${encodeURIComponent(roomId)}`
      : null,
    { cache: queryPolicies.invoices },
  );
  // Debts concern older periods, not necessarily this month's bill. Never
  // replace the current period with the first overdue invoice in the header.
  const invoice = invoices.data?.items.find(
    (item) => item.billingPeriod.slice(0, 7) === month && item.roomId === roomId,
  );
  const readings = useWorkspaceQuery<TenantMeterReadingPage>(
    contractScopeReady
      ? `/api/v1/tenant/meter-readings?page=1&pageSize=20&roomId=${encodeURIComponent(roomId)}`
      : null,
    { load: loadTenantReadings, cache: queryPolicies.meters },
  );
  const notices = useWorkspaceQuery<Page<NotificationItem>>(
    contractScopeReady ? '/api/v1/notifications?page=1&pageSize=3&unread=true' : null,
    { cache: queryPolicies.notifications },
  );
  const expiry = useWorkspaceQuery<ContractExpiryNotice[]>(
    contractScopeReady ? '/api/v1/contracts/expiry-reminders' : null,
    { cache: queryPolicies.contracts },
  );
  const payment = useWorkspaceQuery<InvoicePayment>(
    contractScopeReady && invoice?.status === 'Final'
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
      contracts={visibleContracts}
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
