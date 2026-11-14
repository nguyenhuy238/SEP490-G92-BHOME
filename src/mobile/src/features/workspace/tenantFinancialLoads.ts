import type { SettlementReceivables } from '../../../../../packages/client-core/src/contracts';
import type { TenantMeterReadingPage } from '../../../../../packages/client-core/src/tenantReadings';
import type { MobileApi } from '../../lib/api';

type Row = Record<string, unknown>;
const object = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const money = (v: unknown) => typeof v === 'string' && /^(0|[1-9]\d{0,17})(?:\.0+)?$/.test(v);
const rate = (v: unknown) => typeof v === 'string' && /^(0|[1-9]\d*)(?:\.\d{1,4})?$/.test(v);
const quantity = (v: unknown) => typeof v === 'string' && /^(0|[1-9]\d*)(\.\d+)?$/.test(v);
const integer = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
const wireInteger = (v: unknown) =>
  integer(v) || (typeof v === 'string' && /^(0|[1-9]\d{0,8})$/.test(v));
const invalid = () => new Error('Dữ liệu tài chính từ máy chủ không hợp lệ. Vui lòng tải lại.');

export async function loadTenantSettlements(api: MobileApi, path: string, signal: AbortSignal) {
  const value = await api.request<unknown>(path, { signal });
  if (
    !object(value) ||
    !Array.isArray(value.items) ||
    !integer(value.total) ||
    !value.items.every((source: unknown) => {
      if (
        !object(source) ||
        !text(source.contractId) ||
        !text(source.roomNumber) ||
        !Array.isArray(source.receivables) ||
        !Array.isArray(source.offsets)
      )
        return false;
      return (
        source.receivables.every((row: unknown) => {
          if (
            !object(row) ||
            !object(row.charge) ||
            !text(row.charge.id) ||
            !text(row.charge.description) ||
            !money(row.charge.amount) ||
            !money(row.allocated) ||
            !money(row.outstanding) ||
            !['Paid', 'PartiallyPaid', 'Unpaid'].includes(row.status as string)
          )
            return false;
          const fixed = row.charge.fixedCharge;
          if (
            fixed != null &&
            (!object(fixed) ||
              !rate(fixed.rate) ||
              ![0, 1].includes(fixed.partialMonth as number) ||
              !wireInteger(fixed.occupiedDays) ||
              !wireInteger(fixed.periodDays))
          )
            return false;
          const utility = row.charge.utility;
          return (
            utility == null ||
            (object(utility) &&
              object(utility.baseline) &&
              quantity(utility.baseline.value) &&
              object(utility.final) &&
              quantity(utility.final.value) &&
              quantity(utility.quantity))
          );
        }) &&
        source.offsets.every(
          (offset: unknown) =>
            object(offset) &&
            text(offset.id) &&
            money(offset.amount) &&
            typeof offset.reason === 'string',
        )
      );
    })
  )
    throw invalid();
  return value as unknown as { items: SettlementReceivables[]; total: number };
}

export async function loadTenantReadings(api: MobileApi, path: string, signal: AbortSignal) {
  const value = await api.request<unknown>(path, { signal });
  if (
    !object(value) ||
    !Array.isArray(value.items) ||
    !integer(value.totalCount) ||
    !integer(value.page) ||
    (value.page as number) < 1 ||
    !integer(value.pageSize) ||
    (value.pageSize as number) < 1 ||
    !value.items.every(
      (row: unknown) =>
        object(row) &&
        text(row.id) &&
        text(row.roomId) &&
        text(row.roomNumber) &&
        text(row.locationName) &&
        text(row.meterCode) &&
        ['Electricity', 'Water'].includes(row.utilityType as string) &&
        ['Initial', 'Periodic', 'Final'].includes(row.purpose as string) &&
        typeof row.readingDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.readingDate) &&
        (row.billingPeriod === null ||
          (typeof row.billingPeriod === 'string' &&
            /^\d{4}-\d{2}-\d{2}$/.test(row.billingPeriod))) &&
        quantity(row.confirmedValue) &&
        (row.previousValue === null || quantity(row.previousValue)) &&
        (row.consumption === null || quantity(row.consumption)) &&
        typeof row.confirmedAt === 'string' &&
        Number.isFinite(Date.parse(row.confirmedAt)) &&
        ['Confirmed', 'Corrected'].includes(row.status as string),
    )
  )
    throw invalid();
  return value as unknown as TenantMeterReadingPage;
}
