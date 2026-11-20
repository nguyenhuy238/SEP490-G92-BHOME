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
  utilityCalculationSnapshot?: string | null;
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
export function hasSettlementUsageCoverage(line: InvoiceLine): boolean {
  if (!/^0(?:\.0+)?$/.test(line.amount) || !line.utilityCalculationSnapshot) return false;
  try {
    return JSON.parse(line.utilityCalculationSnapshot)?.kind === 'CoveredBySettlement/v1';
  } catch {
    return false;
  }
}
export function hasSettlementFixedCoverage(line: InvoiceLine): boolean {
  if (!line.utilityCalculationSnapshot) return false;
  try {
    const snapshot = JSON.parse(line.utilityCalculationSnapshot);
    if (snapshot?.kind !== 'FixedChargeCoverage/v1') return false;
    const source = snapshot.source;
    if (source && (source.ResidentCount != null || source.residentCount != null))
      return Number(source.AlreadyPricedAmount ?? source.alreadyPricedAmount ?? 0) > 0;
    return true;
  } catch {
    return false;
  }
}
/** A person-month line can carry calculation evidence even when no settlement was deducted. */
export function invoicePersonMonths(
  line: InvoiceLine,
): { residentCount: number; personDays: number; prorated: boolean } | null {
  try {
    const snapshot = JSON.parse(line.utilityCalculationSnapshot ?? 'null');
    if (snapshot?.kind !== 'FixedChargeCoverage/v1' || !snapshot.source) return null;
    const source = snapshot.source;
    const residentCount = Number(source.ResidentCount ?? source.residentCount);
    const personDays = Number(source.PersonDays ?? source.personDays);
    if (
      !Number.isSafeInteger(residentCount) ||
      residentCount < 0 ||
      !Number.isSafeInteger(personDays) ||
      personDays < 0
    )
      return null;
    return {
      residentCount,
      personDays,
      prorated: Number(source.PartialMonth ?? source.partialMonth) === 1,
    };
  } catch {
    return null;
  }
}
export interface Invoice {
  type?: 'PERIODIC' | 'FINAL' | 'AD_HOC';
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
export interface InvoiceListFilter {
  locationId?: string;
  billingPeriod?: string;
  status?: 'Draft' | 'Final';
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
  firstUsedAt?: string | null;
  lastContractEndDate?: string | null;
  familyId?: string;
  edition?: number;
  bindingContractCount?: number;
  canEditInPlace?: boolean;
  previousPolicyId?: string | null;
}
export type PolicyInput = Omit<
  Policy,
  | 'id'
  | 'version'
  | 'rate'
  | 'firstUsedAt'
  | 'lastContractEndDate'
  | 'familyId'
  | 'edition'
  | 'bindingContractCount'
  | 'canEditInPlace'
  | 'previousPolicyId'
> & {
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
    list: (page = 1, signal?: AbortSignal, roomId = '', filter: InvoiceListFilter = {}) => {
      const query = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (roomId) query.set('roomId', roomId);
      for (const [key, value] of Object.entries(filter)) if (value) query.set(key, value);
      return request<Page<Invoice>>(`/api/v1/invoices?${query}`, { signal });
    },
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
  invalid_contact_phone: 'Số điện thoại liên hệ không đúng định dạng.',
  invalid_invoice_filter: 'Chọn cơ sở, kỳ tháng và trạng thái hóa đơn hợp lệ.',
  stale_version: 'Cấu hình đã thay đổi. Tải lại và kiểm tra phiên bản trước khi lưu.',
  duplicate_or_overlapping_configuration:
    'Cấu hình bị trùng hoặc có kỳ hiệu lực chồng lấn. Kiểm tra dữ liệu trước khi lưu.',
  billing_schedule_required: 'Owner cần cấu hình quy tắc và lịch lập hóa đơn cho cơ sở.',
  billing_initial_schedule_required:
    'Chọn quy tắc tính tiền và hạn thanh toán ngay tại màn tạo lịch trước khi lưu.',
  billing_automation_changed:
    'Lịch hoặc quy tắc tính tiền đã được thay đổi. Tải lại trang trước khi lưu.',
  billing_schedule_changed: 'Cấu hình đã thay đổi. Hãy tải lại trước khi lưu.',
  invalid_billing_calendar_order:
    'Ngày Nháp phải trước hoặc bằng ngày Phát hành, ngày Hạn trả phải sau hoặc bằng ngày Phát hành.',
  invalid_billing_schedule: 'Chọn đầy đủ quy tắc, ngày 1–31 và tháng cộng thêm 0–2.',
  draft_date_not_reached: 'Chưa đến ngày lập nháp đã cấu hình.',
  finalization_date_not_reached: 'Chưa đến ngày phát hành đã cấu hình.',
  invoice_adjustment_pending:
    'Hóa đơn đang có yêu cầu điều chỉnh chờ Owner xác nhận. Hãy duyệt hoặc từ chối yêu cầu trước khi phát hành.',
  confirmed_billing_inputs_required:
    'Thiếu giá hoặc chỉ số đã xác nhận. Hãy bổ sung rồi cập nhật bản nháp.',
  draft_refresh_and_review_required:
    'Đầu vào đã thay đổi. Cập nhật và xem lại bản nháp trước khi phát hành.',
  invoice_changed_or_final: 'Hóa đơn đã thay đổi hoặc đã phát hành. Hãy tải lại.',
  representative_contract_not_eligible:
    'Chọn hợp đồng của phòng có hiệu lực trong kỳ cần lập hóa đơn.',
  invoice_period_already_exists: 'Phòng đã có hóa đơn kỳ này với hợp đồng đại diện khác.',
  room_pricing_locked_by_contract:
    'Phòng đang có hợp đồng ràng buộc giá. Không thể sửa trực tiếp giá này khi hợp đồng còn ràng buộc.',
  utility_tariff_locked_by_contract:
    'Biểu giá đang được cấu hình cho phòng có hợp đồng ràng buộc. Chưa thể thay thế biểu giá này khi hợp đồng còn ràng buộc.',
  profile_replacement_conflict:
    'Cấu hình phòng đã thay đổi hoặc đã có phiên bản kế tiếp. Hãy tải lại trước khi lưu.',
  contract_price_snapshot_required_for_successor:
    'Chưa đủ dữ liệu giá đã chốt của hợp đồng hiện tại. Cần kiểm tra hợp đồng trước khi tạo giá dịch vụ kế tiếp.',
  billing_policy_overlap:
    'Khoản thu này đã có biểu giá cùng phạm vi trong thời gian được chọn. Chọn khoảng hiệu lực không chồng lấn.',
  replacement_date_invalid:
    'Ngày bắt đầu giá kế tiếp phải sau ngày hiện tại, sau ngày bắt đầu giá cũ và trong thời hạn giá cũ.',
  replacement_scope_mismatch: 'Giá kế tiếp phải giữ nguyên phạm vi, loại và mã khoản thu.',
  invalid_asset_observation: 'Kiểm tra số lượng thực tế, bằng chứng và phiên bản định mức.',
  asset_already_verified: 'Tài sản này đã được liên kết với định mức, không thể xác minh trùng.',
  duplicate_shared_name:
    'Tên mẫu đã tồn tại. Hãy chọn tên khác hoặc sử dụng mẫu đã có (kể cả mẫu lưu trữ).',
  shared_draft_already_exists: 'Mẫu này đã có bản nháp. Hãy tiếp tục chỉnh sửa bản nháp hiện có.',
  shared_catalog_stale_or_unpublished:
    'Mẫu tài sản tham chiếu đã thay đổi hoặc được lưu trữ. Hãy bỏ mục cũ và chọn lại tài sản đang sử dụng.',
  shared_source_stale_or_unpublished:
    'Mẫu nguồn đã thay đổi hoặc được lưu trữ. Tải lại thư viện và chọn lại mẫu trước khi lưu.',
  stale_or_immutable_shared_version:
    'Phiên bản mẫu đã thay đổi hoặc không còn chỉnh sửa được. Tải lại để chọn phiên bản mới nhất.',
  policy_successor_date_invalid:
    'Chọn ngày hiệu lực mới không trước hôm nay và sau ngày bắt đầu của phiên bản cũ.',
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
    meter_replacement_allocation_required:
      'Cần Owner duyệt phân bổ tiêu thụ khi thay đồng hồ trong kỳ',
    final_utility_amount_out_of_range: 'Lượng hoặc số tiền vượt phạm vi hợp lệ; cần đối chiếu lại',
    legacy_deduction_requires_migration_review:
      'Đã có quyết định khấu trừ cọc theo hồ sơ cũ; cần đối chiếu trước khi chuyển sang khoản phải thu',
    occupant_account_email_required:
      'Cần tài khoản và email hợp lệ cho các thành viên thuộc nghĩa vụ',
    billing_schedule_required: 'Owner cần chọn chính sách và lịch tính tiền áp dụng',
    billing_schedule_snapshot_invalid: 'Cần đối chiếu chính sách của kỳ trước khi tính khoản chốt',
    owner_confirmed_inspection_required: 'Cần Owner xác nhận biên bản và chỉ số chốt',
    final_meter_readings_required: 'Thiếu chỉ số điện/nước chốt đã xác nhận',
    room_billing_period_still_open:
      'Phòng còn hợp đồng tiếp tục thuê; đối chiếu tiền thuê qua hóa đơn chung của kỳ, không tự chia phần cá nhân',
    fixed_charge_policy_changed:
      'Chính sách tiền thuê/phí khác nguồn đã tính; cần Owner đối chiếu trước khi thu thêm',
    fixed_charge_occupancy_changed:
      'Khoảng ở thay đổi so với khoản đã ghi nhận; cần điều chỉnh có phê duyệt',
    fixed_charge_coverage_invalid: 'Nguồn khoản thu tiền thuê/phí cần được đối chiếu',
    fixed_charge_occupancy_required: 'Thiếu khoảng ở hợp lệ để tính tiền thuê',
    fixed_charge_resident_occupancy_required:
      'Thiếu danh sách hoặc khoảng cư trú hợp lệ để tính phí theo người.',
    signed_contract_snapshot_required: 'Thiếu phiên bản điều khoản hợp đồng đã ký',
    contract_charge_snapshot_required:
      'Thiếu biểu phí đã chốt của hợp đồng. Cần đối chiếu điều khoản gốc trước khi tính tiền.',
    contract_price_snapshot_missing:
      'Thiếu biểu phí đã chốt của hợp đồng. Cần đối chiếu điều khoản gốc trước khi tính tiền.',
    contract_price_snapshot_invalid:
      'Biểu phí đã chốt không hợp lệ. Cần đối chiếu điều khoản gốc trước khi tính tiền.',
    room_contract_price_conflict:
      'Các hợp đồng trong phòng có biểu phí đã chốt khác nhau. Cần đối chiếu trước khi lập hóa đơn chung.',
    confirmed_billable_baseline_required: 'Thiếu mốc ban đầu hoặc mốc đã tính tiền có chứng từ',
    settlement_metered_policy_required: 'Cần một chính sách giá theo chỉ số phù hợp',
    utility_pricing_baseline_required: 'Thiếu chính sách giá của phần tiêu thụ đã ghi nhận',
    utility_profile_changed_since_billing:
      'Chính sách điện/nước đã thay đổi; cần đối chiếu phần đã tính',
    utility_increment_policy_changed:
      'Biểu giá hoặc định mức của phần đã ghi nhận thay đổi; cần đối chiếu',
    utility_increment_requires_adjustment: 'Cần quyết định điều chỉnh; không tự tạo khoản thu âm',
    utility_quota_verification_required: 'Thiếu định mức miễn phí đã xác nhận',
    utility_period_split_requires_review: 'Cần phân đoạn tiêu thụ theo biểu giá hiệu lực',
    utility_period_breakdown_stale: 'Phân đoạn tiêu thụ cần được Owner kiểm tra lại',
    utility_prior_period_billing_required: 'Còn kỳ trước chưa có mốc tính tiền phù hợp',
    utility_prior_occupancy_allocation_required:
      'Có tiêu thụ trước mốc nhận phòng mới cần Owner phân định',
    utility_duplicate_billing_detected:
      'Lịch sử có khoảng tiêu thụ trùng; cần đối chiếu trước khi thu thêm',
    utility_coverage_gap_requires_review: 'Lịch sử tiêu thụ có khoảng chưa được đối chiếu',
    utility_billed_source_integrity_failed: 'Nguồn đã tính tiền không khớp với chỉ số gốc',
    utility_calculation_snapshot_invalid: 'Chứng cứ tính giá cần được kiểm tra lại',
    final_reading_below_billed_baseline: 'Chỉ số chốt thấp hơn mốc đã tính tiền; cần đối chiếu',
    inspection_snapshot_invalid: 'Chỉ số hoặc ảnh không còn khớp với biên bản đã duyệt',
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
