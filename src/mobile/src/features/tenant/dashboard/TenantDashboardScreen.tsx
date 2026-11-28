import React, { useCallback } from 'react';
import { queryPolicies } from '../../../lib/queryPolicies';
import { useWorkspaceHeaderRefresh } from '../../../components/WorkspaceHeaderContext';
import { useWorkspaceQuery } from '../../workspace/useWorkspaceQuery';
import { useSession } from '../../../lib/SessionProvider';
import type { ContractPage } from '../../../../../../packages/client-core/src/contracts';
import type { Invoice, Page } from '../../../../../../packages/client-core/src/invoices';
import type { InvoicePayment } from '../../../../../../packages/client-core/src/payments';
import { businessToday } from '../../../../../../packages/client-core/src/contracts';
import { isActiveRoomRental } from '../room/tenantContractEligibility';
import { useTenantCurrentRental } from '../room/TenantCurrentRentalContext';
import type { TenantMeterReadingPage } from '../../../../../../packages/client-core/src/tenantReadings';
import { loadTenantReadings } from '../../workspace/tenantFinancialLoads';
import { TenantDashboard } from './TenantDashboard';
import {
  loadTenantInvoicePeriod,
  tenantInvoiceScheduleMessage,
  type TenantInvoicePeriod,
} from '../../../services/tenantInvoices';

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
  const period = useWorkspaceQuery<TenantInvoicePeriod>(
    contractScopeReady && invoices.data && !invoices.error && !invoice
      ? '/api/v1/invoices/current-period'
      : null,
    { load: loadTenantInvoicePeriod, cache: queryPolicies.invoices, notifyError: false },
  );
  const invoiceScheduleMessage = period.loading
    ? 'Đang tải lịch phát hành hóa đơn…'
    : tenantInvoiceScheduleMessage(
        !period.error && period.data?.billingPeriod === month + '-01' ? period.data : null,
      );
  const readings = useWorkspaceQuery<TenantMeterReadingPage>(
    contractScopeReady
      ? `/api/v1/tenant/meter-readings?page=1&pageSize=20&roomId=${encodeURIComponent(roomId)}`
      : null,
    { load: loadTenantReadings, cache: queryPolicies.meters },
  );
  const payment = useWorkspaceQuery<InvoicePayment>(
    contractScopeReady && invoice?.status === 'Final'
      ? `/api/v1/invoices/${encodeURIComponent(invoice.id)}/payment`
      : null,
    { cache: queryPolicies.payments },
  );
  const reloadContracts = contracts.reload,
    reloadInvoices = invoices.reload,
    reloadPeriod = period.reload,
    reloadReadings = readings.reload,
    reloadPayment = payment.reload;
  const reload = useCallback(() => {
    reloadContracts();
    reloadInvoices();
    reloadPeriod();
    reloadReadings();
    reloadPayment();
  }, [reloadContracts, reloadInvoices, reloadPeriod, reloadReadings, reloadPayment]);
  useWorkspaceHeaderRefresh(
    reload,
    [contracts, invoices, period, readings, payment].some((query) => query.fetching),
  );
  return (
    <TenantDashboard
      contracts={visibleContracts}
      activeRental={allowed && verifiedRental ? verifiedRental : undefined}
      month={month}
      invoice={invoice}
      invoiceScheduleMessage={invoiceScheduleMessage}
      meterReadings={readings.data?.items}
      meterState={readings}
      payment={payment.data ?? undefined}
      contractState={contracts}
      invoiceState={invoices}
      paymentState={payment}
    />
  );
}
