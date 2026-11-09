import { ApiError } from './api';
import { groupVietnameseIntegerDigits } from './localization';

// Keep decimal strings exact, including amounts beyond Number.MAX_SAFE_INTEGER.
export function formatBillingDecimal(value: string | number): string {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) return '—';
  const [whole, digits = ''] = text.split('.');
  const fraction = digits.replace(/0+$/, '');
  return groupVietnameseIntegerDigits(whole!) + (fraction ? ',' + fraction : '');
}

export interface InvoiceLine {
  id: string;
  category: string;
  chargeCode: string;
  name: string;
  policyId: string | null;
  policyVersion: number | null;
  rateDate: string;
  rate: string;
  quantity: string;
  occupiedDays: number;
  periodDays: number;
  amount: string;
  meterReadingId: string | null;
  previousReading: string | null;
  confirmedReading: string | null;
  calculatedAmount?: string | null;
  correctionRequestId?: string | null;
}
export interface Invoice {
  id: string;
  roomId: string;
  locationId: string;
  roomNumber: string;
  locationName: string;
  billingPeriod: string;
  status: 'Draft' | 'Final';
  version: number;
  total: string;
  missingInputs: string[];
  scheduledFinalDate: string;
  dueDate: string;
  finalizedAt: string | null;
  representativeTenantUserId: string;
  lines: InvoiceLine[];
}
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}
export interface BillingSchedule {
  locationId: string;
  rateDate: number;
  rentSource: number;
  partialMonth: number;
  rounding: number;
  draftDay: number;
  draftMonthOffset: number;
  finalDay: number;
  finalMonthOffset: number;
  dueDay: number;
  dueMonthOffset: number;
  version: number;
}
export interface Policy {
  id: string;
  locationId: string;
  roomId: string | null;
  category: number;
  chargeCode: string;
  name: string;
  method: number;
  rate: string | number;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
}
export type PolicyInput = Omit<Policy, 'id' | 'version' | 'rate'> & {
  rate: string;
  reason: string;
};
export function billingPolicyPayload(input: PolicyInput): PolicyInput {
  return {
    locationId: input.locationId,
    roomId: input.roomId ?? null,
    category: input.category,
    chargeCode: input.chargeCode,
    name: input.name,
    method: input.method,
    rate: input.rate,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo ?? null,
    reason: input.reason,
  };
}
export function invoiceClient(request: <T>(path: string, init?: RequestInit) => Promise<T>) {
  const json = <T>(path: string, body: unknown, method = 'POST') =>
    request<T>(path, { method, body: JSON.stringify(body) });
  return {
    list: (page = 1, signal?: AbortSignal, roomId = '') =>
      request<Page<Invoice>>(
        `/api/v1/invoices?page=${page}&pageSize=20${roomId ? `&roomId=${encodeURIComponent(roomId)}` : ''}`,
        { signal },
      ),
    get: (id: string, signal?: AbortSignal) =>
      request<Invoice>(`/api/v1/invoices/${encodeURIComponent(id)}`, { signal }),
    draft: (roomId: string, billingPeriod: string, representativeContractId: string) =>
      json<Invoice>('/api/v1/invoices/drafts', { roomId, billingPeriod, representativeContractId }),
    refresh: (id: string, expectedVersion: number) =>
      json<Invoice>(`/api/v1/invoices/${encodeURIComponent(id)}/refresh`, { expectedVersion }),
    finalize: (id: string, expectedVersion: number) =>
      json<Invoice>(`/api/v1/invoices/${encodeURIComponent(id)}/finalize`, { expectedVersion }),
    schedule: (id: string, signal?: AbortSignal) =>
      request<BillingSchedule | undefined>(`/api/v1/billing-schedules/${encodeURIComponent(id)}`, {
        signal,
      }),
    saveSchedule: (schedule: BillingSchedule) =>
      json<BillingSchedule>(
        '/api/v1/billing-schedules',
        { ...schedule, expectedVersion: schedule.version },
        'PUT',
      ),
    policies: (locationId: string, page: number, signal?: AbortSignal) =>
      request<Page<Policy>>(
        `/api/v1/billing-policies?locationId=${encodeURIComponent(locationId)}&page=${page}&pageSize=20`,
        { signal },
      ),
    createPolicy: (input: PolicyInput) =>
      json<Policy>('/api/v1/billing-policies', billingPolicyPayload(input)),
    replacePolicy: (id: string, policy: PolicyInput, expectedVersion: number) =>
      json<Policy>(`/api/v1/billing-policies/${encodeURIComponent(id)}/replacement`, {
        policy: billingPolicyPayload(policy),
        expectedVersion,
      }),
  };
}
const messages: Record<string, string> = {
  stale_version: 'Cấu hình đã thay đổi. Tải lại và kiểm tra phiên bản trước khi lưu.',
  duplicate_or_overlapping_configuration:
    'Cấu hình bị trùng hoặc có kỳ hiệu lực chồng lấn. Kiểm tra dữ liệu trước khi lưu.',
  billing_schedule_required: 'Owner cần cấu hình quy tắc và lịch lập hóa đơn cho cơ sở.',
  billing_schedule_changed: 'Cấu hình đã thay đổi. Hãy tải lại trước khi lưu.',
  invalid_billing_calendar_order:
    'Ngày Nháp phải trước hoặc bằng ngày Phát hành, ngày Hạn trả phải sau hoặc bằng ngày Phát hành.',
  invalid_billing_schedule: 'Chọn đầy đủ quy tắc, ngày 1–31 và tháng cộng thêm 0–2.',
  draft_date_not_reached: 'Chưa đến ngày lập nháp đã cấu hình.',
  finalization_date_not_reached: 'Chưa đến ngày phát hành đã cấu hình.',
  confirmed_billing_inputs_required:
    'Thiếu giá hoặc chỉ số đã xác nhận. Hãy bổ sung rồi cập nhật bản nháp.',
  draft_refresh_and_review_required:
    'Đầu vào đã thay đổi. Cập nhật và xem lại bản nháp trước khi phát hành.',
  invoice_changed_or_final: 'Hóa đơn đã thay đổi hoặc đã phát hành. Hãy tải lại.',
  representative_contract_not_eligible:
    'Chọn hợp đồng của phòng có hiệu lực trong kỳ cần lập hóa đơn.',
  invoice_period_already_exists: 'Phòng đã có hóa đơn kỳ này với hợp đồng đại diện khác.',
};
export function invoiceError(error: unknown): string {
  const value = error as { status?: number; code?: string; problem?: { code?: string } };
  const code =
    error instanceof ApiError ? error.problem?.code : (value?.code ?? value?.problem?.code);
  return (
    (code && messages[code]) ||
    (value?.status === 409
      ? 'Cấu hình đã thay đổi hoặc bị xung đột. Tải lại và kiểm tra trước khi lưu.'
      : value?.status === 400
        ? 'Dữ liệu chưa hợp lệ. Kiểm tra phạm vi, đơn giá và ngày hiệu lực.'
        : value?.status === 403
          ? 'Tài khoản không có quyền thực hiện thao tác này.'
          : value?.status === 404
            ? 'Không tìm thấy dữ liệu trong phạm vi tài khoản.'
            : 'Chưa hoàn thành yêu cầu. Tải lại dữ liệu để kiểm tra trước khi thử lại.')
  );
}
export function missingBillingInput(code: string): string {
  const labels: Record<string, string> = {
    rate_Rent: 'Giá thuê',
    rate_Electricity: 'Giá điện',
    rate_Water: 'Giá nước',
    confirmed_reading_Electricity: 'Chỉ số điện hợp lệ đã xác nhận',
    confirmed_reading_Water: 'Chỉ số nước hợp lệ đã xác nhận',
    baseline_Electricity: 'Chỉ số điện trước',
    baseline_Water: 'Chỉ số nước trước',
    draft_correction_source_changed:
      'Nguồn tính phí đã thay đổi; Owner cần kiểm tra correction đã duyệt',
  };
  return labels[code] ?? 'Đầu vào cần kiểm tra';
}
