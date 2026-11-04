import React from 'react';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useSession } from '../lib/SessionProvider';
import type { ContractPage } from '../../../../packages/client-core/src/contracts';
import type { Invoice, Page } from '../../../../packages/client-core/src/invoices';
import type { InvoicePayment } from '../../../../packages/client-core/src/payments';
import { TenantDashboard } from './TenantDashboard';

// Presentation reads only: reuse the same Tenant endpoints as the existing detail screens.
export function TenantDashboardScreen() {
  const { session } = useSession();
  const allowed = session?.roles.includes('Tenant');
  const contracts = useWorkspaceQuery<ContractPage>(
    allowed ? '/api/v1/contracts?page=1&pageSize=5' : null,
  );
  const invoices = useWorkspaceQuery<Page<Invoice>>(
    allowed ? '/api/v1/invoices?page=1&pageSize=20' : null,
  );
  const month = new Date()
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    .slice(0, 7);
  const invoice = invoices.data?.items.find((item) => item.billingPeriod.slice(0, 7) === month);
  const payment = useWorkspaceQuery<InvoicePayment>(
    allowed && invoice?.status === 'Final'
      ? `/api/v1/invoices/${encodeURIComponent(invoice.id)}/payment`
      : null,
  );
  return (
    <TenantDashboard
      contracts={contracts.data?.items}
      invoice={invoice}
      payment={payment.data ?? undefined}
      contractState={contracts}
      invoiceState={invoices}
      paymentState={payment}
    />
  );
}
