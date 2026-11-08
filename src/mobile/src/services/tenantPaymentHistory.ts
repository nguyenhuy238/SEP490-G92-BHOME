import type { DebtInvoice, PaymentHistory } from '../../../../packages/client-core/src/payments';
import type { Page } from '../../../../packages/client-core/src/invoices';
import { dateOnly } from '../../../../packages/client-core/src/contracts';
import { MobileApiError, type MobileApi } from '../lib/api';

export type LedgerItem = PaymentHistory | DebtInvoice;
export type LedgerPage = Page<LedgerItem>;
export type LedgerTab = 'verified' | 'outstanding';
export interface LedgerFilters {
  period: string;
  roomId: string;
  overdueOnly: boolean;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const money = (v: unknown): v is string => typeof v === 'string' && /^\d+$/.test(v);
const signed = (v: unknown) => typeof v === 'string' && /^-?\d+$/.test(v);
const day = (v: unknown) => {
  try {
    return typeof v === 'string' && dateOnly(v) === v;
  } catch {
    return false;
  }
};
const instant = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
function invalid(): never {
  throw new MobileApiError(502, 'invalid_response');
}
export function ledgerPeriod(input: string) {
  if (!input.trim()) return '';
  if (!/^(0[1-9]|1[0-2])\/\d{4}$/.test(input.trim())) throw new Error('Nhập kỳ theo MM/YYYY.');
  const [month, year] = input.trim().split('/');
  const value = `${year}-${month}-01`;
  if (!day(value)) throw new Error('Kỳ hóa đơn không hợp lệ.');
  return value;
}
export function ledgerPath(tab: LedgerTab, page: number, filters: LedgerFilters) {
  const query = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (filters.period) query.set('billingPeriod', filters.period);
  if (filters.roomId) query.set('roomId', filters.roomId);
  if (tab === 'outstanding' && filters.overdueOnly) query.set('overdueOnly', 'true');
  return `/api/v1/${tab === 'verified' ? 'payment-history' : 'debts'}?${query}`;
}
export async function loadLedgerPage(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
): Promise<LedgerPage> {
  const result = await api.request<unknown>(path, { signal });
  const requested = new URLSearchParams(path.split('?')[1]);
  if (
    !object(result) ||
    !Array.isArray(result.items) ||
    !Number.isSafeInteger(result.totalCount) ||
    (result.totalCount as number) < result.items.length ||
    result.page !== Number(requested.get('page')) ||
    result.pageSize !== Number(requested.get('pageSize')) ||
    result.items.length > (result.pageSize as number)
  )
    invalid();
  const history = path.startsWith('/api/v1/payment-history?');
  for (const row of result.items) {
    if (
      !object(row) ||
      !['invoiceId', 'locationId', 'roomId', 'locationName', 'roomNumber'].every(
        (k) => typeof row[k] === 'string',
      ) ||
      !['invoiceId', 'locationId', 'roomId'].every((k) => (row[k] as string).length > 0) ||
      !day(row.billingPeriod)
    )
      invalid();
    if (history) {
      if (
        typeof row.id !== 'string' ||
        typeof row.paidBy !== 'string' ||
        typeof row.verificationSource !== 'string' ||
        !money(row.amount) ||
        !instant(row.paidAt)
      )
        invalid();
    } else if (
      !['Paid', 'Unpaid'].includes(row.paymentStatus as string) ||
      !day(row.dueDate) ||
      !money(row.outstandingAmount) ||
      !Number.isSafeInteger(row.overdueDays) ||
      (row.overdueDays as number) < 0 ||
      ![row.payableAmount, row.paidAmount].every((v) => v === null || money(v)) ||
      [row.originalIssuedAmount, row.potentialExcessAmount].some((v) => v != null && !money(v)) ||
      (row.approvedAdjustmentTotal != null && !signed(row.approvedAdjustmentTotal))
    )
      invalid();
  }
  if (
    new Set(result.items.map((row) => (history ? row.id : row.invoiceId))).size !==
    result.items.length
  )
    invalid();
  // Tenant presentation never retains private verifier/bank reference values.
  return {
    ...result,
    items: result.items.map((row) =>
      history ? { ...row, bankReference: null, verifiedByUserId: null } : row,
    ),
  } as LedgerPage;
}
export function verificationLabel(source: string) {
  return source === 'OwnerBankStatement' ? 'Owner đối soát sao kê' : 'Nguồn xác minh khác';
}
function compareMoney(a: string, b: string) {
  const left = a.replace(/^0+(?=\d)/, ''),
    right = b.replace(/^0+(?=\d)/, '');
  return left.length - right.length || (left < right ? -1 : left > right ? 1 : 0);
}
export function sortLedgerRows(items: LedgerItem[], sort: string): LedgerItem[] {
  if (sort === 'server') return items;
  return [...items].sort((a, b) =>
    sort === 'amount'
      ? compareMoney(
          'amount' in b ? b.amount : b.outstandingAmount,
          'amount' in a ? a.amount : a.outstandingAmount,
        )
      : 'paidAt' in a && 'paidAt' in b
        ? Date.parse(b.paidAt) - Date.parse(a.paidAt)
        : 0,
  );
}
