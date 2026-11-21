import type { Invoice, Page } from '../../../../packages/client-core/src/invoices';
import type {
  InvoicePayment,
  TransferInstructions,
  DebtInvoice,
} from '../../../../packages/client-core/src/payments';
import type { Adjustment } from '../../../../packages/client-core/src/adjustments';
import { dateOnly } from '../../../../packages/client-core/src/contracts';
import { MobileApiError, type MobileApi } from '../lib/api';
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const money = (v: unknown) => typeof v === 'string' && /^\d+$/.test(v);
const decimal = (v: unknown) => typeof v === 'string' && /^\d+(?:\.\d{1,4})?$/.test(v);
const fields = (v: Obj, keys: string[]) => keys.every((k) => typeof v[k] === 'string');
const instant = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const day = (v: unknown) => {
  try {
    return typeof v === 'string' && dateOnly(v) === v;
  } catch {
    return false;
  }
};
function invalid(): never {
  throw new MobileApiError(502, 'invalid_response');
}
function pageValue(v: unknown): v is Obj & { items: Obj[] } {
  return (
    obj(v) &&
    Array.isArray(v.items) &&
    v.items.every(obj) &&
    Number.isSafeInteger(v.totalCount) &&
    (v.totalCount as number) >= v.items.length &&
    Number.isSafeInteger(v.page) &&
    (v.page as number) > 0 &&
    Number.isSafeInteger(v.pageSize) &&
    (v.pageSize as number) > 0
  );
}
export async function loadInvoiceList(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
): Promise<Page<Invoice>> {
  const v = await api.request<unknown>(path, { signal });
  if (
    !pageValue(v) ||
    !v.items.every(
      (i) =>
        fields(i, ['id', 'roomNumber', 'locationName', 'billingPeriod']) &&
        ['Draft', 'Final'].includes(i.status as string) &&
        money(i.total) &&
        day(i.billingPeriod) &&
        Array.isArray(i.missingInputs) &&
        i.missingInputs.every((x) => typeof x === 'string'),
    )
  )
    invalid();
  return v as unknown as Page<Invoice>;
}
export async function loadTenantInvoice(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
): Promise<Invoice> {
  const v = await api.request<unknown>(path, { signal });
  if (
    !obj(v) ||
    !fields(v, [
      'id',
      'roomNumber',
      'locationName',
      'billingPeriod',
      'dueDate',
      'scheduledFinalDate',
    ]) ||
    v.id !== decodeURIComponent(path.split('/').pop()!) ||
    !['Draft', 'Final'].includes(v.status as string) ||
    !Number.isSafeInteger(v.version) ||
    (v.version as number) < 1 ||
    !money(v.total) ||
    ![v.billingPeriod, v.dueDate, v.scheduledFinalDate].every(day) ||
    (v.finalizedAt != null && !instant(v.finalizedAt)) ||
    !Array.isArray(v.missingInputs) ||
    !v.missingInputs.every((i) => typeof i === 'string') ||
    !Array.isArray(v.lines) ||
    !v.lines.every(
      (line) =>
        obj(line) &&
        fields(line, ['id', 'category', 'name', 'rateDate']) &&
        day(line.rateDate) &&
        ['Rent', 'Electricity', 'Water', 'ServiceFee', 'Other'].includes(line.category as string) &&
        decimal(line.rate) &&
        (line.quantity === null || decimal(line.quantity)) &&
        money(line.amount) &&
        Number.isInteger(line.occupiedDays) &&
        Number.isInteger(line.periodDays) &&
        [line.previousReading, line.confirmedReading].every((r) => r === null || decimal(r)) &&
        (line.calculatedAmount == null || money(line.calculatedAmount)),
    )
  )
    invalid();
  return v as unknown as Invoice;
}
export async function loadInvoicePaymentStates(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
): Promise<Page<DebtInvoice>> {
  const value = await api.request<unknown>(path, { signal });
  const requestedIds = new URLSearchParams(path.split('?')[1]).getAll('invoiceIds');
  if (
    !pageValue(value) ||
    new Set(value.items.map((item) => item.invoiceId)).size !== value.items.length ||
    !value.items.every(
      (item) =>
        typeof item.invoiceId === 'string' &&
        requestedIds.includes(item.invoiceId) &&
        ['Paid', 'Unpaid'].includes(item.paymentStatus as string) &&
        money(item.outstandingAmount) &&
        (item.paidAmount === null || money(item.paidAmount)) &&
        day(item.dueDate) &&
        Number.isSafeInteger(item.overdueDays) &&
        (item.overdueDays as number) >= 0,
    )
  )
    invalid();
  return value as unknown as Page<DebtInvoice>;
}
export async function loadInvoicePayment(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
): Promise<InvoicePayment> {
  const v = await api.request<unknown>(path, { signal });
  if (
    !obj(v) ||
    v.invoiceId !== decodeURIComponent(path.split('/').at(-2)!) ||
    !['Paid', 'Unpaid', 'NotIssued'].includes(v.paymentStatus as string) ||
    ![v.payableAmount, v.paidAmount, v.outstandingAmount].every(money) ||
    !day(v.dueDate) ||
    !Number.isInteger(v.overdueDays) ||
    !Array.isArray(v.history) ||
    !v.history.every(
      (h) =>
        obj(h) &&
        fields(h, ['id', 'paidBy']) &&
        instant(h.paidAt) &&
        instant(h.verifiedAt) &&
        money(h.amount),
    ) ||
    [v.originalIssuedAmount, v.potentialExcessAmount].some((a) => a !== undefined && !money(a)) ||
    (v.approvedAdjustmentTotal !== undefined &&
      (typeof v.approvedAdjustmentTotal !== 'string' || !/^-?\d+$/.test(v.approvedAdjustmentTotal)))
  )
    invalid();
  return v as unknown as InvoicePayment;
}
export async function loadInvoiceTransfer(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
): Promise<TransferInstructions> {
  const v = await api.request<unknown>(path, { signal });
  if (
    !obj(v) ||
    v.invoiceId !== decodeURIComponent(path.split('/').at(-2)!) ||
    typeof v.availability !== 'string' ||
    !money(v.outstandingAmount) ||
    !fields(v, ['transferDescription']) ||
    ![v.accountNumber, v.accountHolder, v.bankIdentifier, v.qrImageDataUri].every(
      (a) => a === null || typeof a === 'string',
    )
  )
    invalid();
  return v as unknown as TransferInstructions;
}
export async function loadAdjustmentPage<T>(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
): Promise<Page<T>> {
  const v = await api.request<unknown>(path, { signal });
  if (!pageValue(v)) invalid();
  const requests = path.startsWith('/api/v1/invoice-adjustments?');
  if (
    !v.items.every(
      (item) =>
        typeof item.id === 'string' &&
        (requests
          ? typeof item.status === 'string' && instant(item.submittedAt)
          : typeof item.invoiceStatus === 'string' &&
            typeof item.delta === 'string' &&
            /^-?\d+$/.test(item.delta) &&
            instant(item.decidedAt)),
    )
  )
    invalid();
  return v as unknown as Page<T>;
}
export async function loadTenantAdjustment(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
): Promise<Adjustment> {
  const v = await api.request<unknown>(path, { signal });
  if (
    !obj(v) ||
    !fields(v, ['id', 'status', 'reason']) ||
    v.id !== path.split('/').pop() ||
    !money(v.currentAmount) ||
    (v.proposedAmount != null && !money(v.proposedAmount)) ||
    (v.decision != null &&
      (!obj(v.decision) ||
        !fields(v.decision, ['reason', 'delta']) ||
        !instant(v.decision.decidedAt))) ||
    (v.financials != null &&
      (!obj(v.financials) ||
        ![
          v.financials.effectivePayableAmount,
          v.financials.outstandingAmount,
          v.financials.potentialExcessAmount,
        ].every(money))) ||
    !Array.isArray(v.evidence) ||
    !v.evidence.every((e) => obj(e) && fields(e, ['id', 'contentType']))
  )
    invalid();
  return v as unknown as Adjustment;
}
