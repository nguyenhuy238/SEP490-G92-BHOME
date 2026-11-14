import type { Page } from '../../../../packages/client-core/src/invoices';
import type { TenantRefund } from '../../../../packages/client-core/src/refunds';
import { MobileApiError, type MobileApi } from '../lib/api';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const instant = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
export async function loadTenantRefunds(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
): Promise<Page<TenantRefund>> {
  const data = await api.request<unknown>(path, { signal });
  const requested = new URLSearchParams(path.split('?')[1]);
  if (
    !object(data) ||
    !Array.isArray(data.items) ||
    !Number.isSafeInteger(data.totalCount) ||
    (data.totalCount as number) < data.items.length ||
    data.page !== Number(requested.get('page')) ||
    data.pageSize !== Number(requested.get('pageSize')) ||
    data.items.length > (data.pageSize as number)
  )
    throw new MobileApiError(502, 'invalid_response');
  const rows: TenantRefund[] = [];
  for (const row of data.items) {
    if (
      !object(row) ||
      typeof row.id !== 'string' ||
      !row.id ||
      typeof row.amount !== 'string' ||
      !/^\d+(?:\.0+)?$/.test(row.amount) ||
      /^0+(?:\.0+)?$/.test(row.amount) ||
      !['ReceiptExcess', 'SecurityDeposit', 'HoldingDeposit'].includes(row.sourceKind as string) ||
      !['REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED'].includes(row.status as string) ||
      !instant(row.requestedAt) ||
      !(row.decidedAt === null || instant(row.decidedAt)) ||
      !(row.executedAt === null || instant(row.executedAt)) ||
      typeof row.isDevelopmentDemo !== 'boolean' ||
      (row.status === 'COMPLETED' && !instant(row.executedAt))
    )
      throw new MobileApiError(502, 'invalid_response');
    // Retain only the Tenant contract even if a future server accidentally adds private metadata.
    rows.push({
      id: row.id,
      amount: row.amount,
      sourceKind: row.sourceKind,
      status: row.status,
      requestedAt: row.requestedAt,
      decidedAt: row.decidedAt,
      executedAt: row.executedAt,
      isDevelopmentDemo: row.isDevelopmentDemo,
    } as TenantRefund);
  }
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new MobileApiError(502, 'invalid_response');
  return {
    items: rows,
    page: data.page,
    pageSize: data.pageSize,
    totalCount: data.totalCount,
  } as Page<TenantRefund>;
}
