// D011/D012 REST contract. Amounts remain decimal strings throughout the clients.
export const contractStates = [
  'Draft',
  'PendingSigning',
  'PendingActivation',
  'Active',
  'Terminated',
  'Superseded',
  'Cancelled',
] as const;
export interface ContractSummary {
  id: string;
  roomId: string;
  locationId: string;
  locationName: string;
  roomNumber: string;
  kind: string;
  status: string;
  startDate: string;
  endDate: string;
  monthlyRent: string;
}
export interface ContractPage {
  items: ContractSummary[];
  page: number;
  pageSize: number;
  totalCount: number;
}
export interface Signature {
  id: string;
  signerUserId: string;
  status: string;
  signedAt: string | null;
}
export interface ContractView {
  id: string;
  roomId: string;
  kind: string;
  status: string;
  startDate: string;
  endDate: string;
  monthlyRent: string;
  requiredDeposit: string;
  terms: string;
  previousContractId: string | null;
  residentIds: string[];
  signatures: Signature[];
  activatedAt: string | null;
  ownerSignerId: string;
  tenantUserId: string;
  representativeResidentId: string;
  holdingContractId: string | null;
  appliedHoldingDeposit: string;
  locationId: string;
}
export interface Readiness {
  ready: boolean;
  verifiedDeposit: string;
  remainingDeposit: string;
  blockers: string[];
}
export interface MoveOut {
  id: string;
  status: string;
  proposedDate: string;
  reason: string;
  inspectionScheduledAt: string | null;
  pendingReason: string;
  inspectionNotes: string | null;
  inspectedAt: string | null;
  electricityReadingId: string | null;
  waterReadingId: string | null;
  evidenceIds: string[];
}
export interface SettlementReview {
  id: string;
  decision: string;
  settled: boolean;
  reviewedAt: string;
  reviewedByUserId: string;
}
export interface Certificate {
  id: string;
  provider: string;
  providerUserIdHint: string;
  serialNumber: string;
  subject: string;
  validTo: string;
  locked: boolean;
  usable: boolean;
}
export interface NamedOption {
  id: string;
  label: string;
  parentId?: string;
}
export interface FinalMeterTask {
  id: string;
  contractId: string | null;
  confirmedReadingId: string | null;
  purpose: number;
  utilityType: number;
  status: number;
  readingDate: string;
  meterCode: string;
}
export interface ResidentOption {
  id: string;
  roomId: string;
  displayLabel: string;
  verificationStatus: number;
}
export type ContractRequest = <T>(
  path: string,
  init?: RequestInit,
  responseType?: 'json' | 'blob' | 'bytes',
) => Promise<T>;
const root = '/api/v1/contracts';
const certificates = '/api/v1/digital-signing/certificates';
export function contractClient(request: ContractRequest) {
  return {
    list: (page = 1, status = '', locationId = '', signal?: AbortSignal) =>
      request<ContractPage>(
        `${root}?${new URLSearchParams({ page: String(page), pageSize: '20', ...(status ? { status } : {}), ...(locationId ? { locationId } : {}) })}`,
        { signal },
      ),
    get: (id: string, signal?: AbortSignal) => request<ContractView>(`${root}/${id}`, { signal }),
    readiness: (id: string, signal?: AbortSignal) =>
      request<Readiness>(`${root}/${id}/activation-readiness`, { signal }),
    moveOut: (id: string, signal?: AbortSignal) =>
      request<MoveOut>(`${root}/${id}/move-out`, { signal }),
    history: (id: string, signal?: AbortSignal) =>
      request<SettlementReview[]>(`${root}/${id}/move-out/settlement-history`, { signal }),
    certificates: (signal?: AbortSignal) => request<Certificate[]>(certificates, { signal }),
    declareCertificate: (providerUserId: string, serialNumber: string) =>
      request<Certificate>(certificates, {
        method: 'POST',
        body: JSON.stringify({ providerUserId, serialNumber: serialNumber || null }),
      }),
    locations: (signal?: AbortSignal) =>
      request<NamedOption[]>('/api/v1/capture/locations', { signal }),
    rooms: (locationId: string, signal?: AbortSignal) =>
      request<NamedOption[]>(`/api/v1/capture/locations/${locationId}/rooms`, { signal }),
    residents: (locationId: string, signal?: AbortSignal) =>
      request<ResidentOption[]>(`/api/v1/capture/locations/${locationId}/residents`, { signal }),
    meters: (locationId: string, signal?: AbortSignal) =>
      request<NamedOption[]>(`/api/v1/capture/locations/${locationId}/meters`, { signal }),
    finalTask: (contractId: string, meterId: string, readingDate: string) =>
      request<{ id: string }>('/api/v1/capture/meter-tasks', {
        method: 'POST',
        body: JSON.stringify({ contractId, meterId, readingDate, purpose: 2, billingPeriod: null }),
      }),
    meterTasks: (signal?: AbortSignal) =>
      request<FinalMeterTask[]>('/api/v1/capture/meter-tasks', { signal }),
    mutate: <T>(id: string | null, operation: string, body: unknown, key: string) =>
      request<T>(root + (id ? `/${id}/${operation}` : ''), {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    document: (id: string, signal?: AbortSignal) =>
      request<Blob>(
        `${root}/${id}/document`,
        { signal, headers: { Accept: 'application/pdf' } },
        'blob',
      ),
    evidence: (id: string, evidenceId: string, signal?: AbortSignal) =>
      request<Blob>(
        `${root}/${id}/move-out/evidence/${evidenceId}`,
        { signal, headers: { Accept: 'application/octet-stream' } },
        'blob',
      ),
    documentBytes: (id: string, signal?: AbortSignal) =>
      request<Uint8Array>(
        `${root}/${id}/document`,
        { signal, headers: { Accept: 'application/pdf' } },
        'bytes',
      ),
    evidenceBytes: (id: string, evidenceId: string, signal?: AbortSignal) =>
      request<Uint8Array>(
        `${root}/${id}/move-out/evidence/${evidenceId}`,
        { signal, headers: { Accept: 'application/octet-stream' } },
        'bytes',
      ),
    upload: (id: string, bytes: BodyInit, contentType: string) =>
      request<{ id: string }>(`${root}/${id}/move-out/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: bytes,
      }),
  };
}
export type ContractClient = ReturnType<typeof contractClient>;
export const labels: Record<string, string> = {
  Main: 'Hợp đồng thuê',
  Renewal: 'Gia hạn',
  Draft: 'Bản nháp',
  PendingSigning: 'Chờ ký',
  PendingActivation: 'Chờ kích hoạt',
  Active: 'Đang hiệu lực',
  Terminated: 'Đã kết thúc',
  Superseded: 'Đã thay thế',
  Cancelled: 'Đã hủy',
  Prepared: 'Đã chuẩn bị ký',
  Dispatching: 'Đang gửi yêu cầu ký',
  Pending: 'Chờ nhà cung cấp xác nhận',
  Signed: 'Đã xác minh chữ ký',
  Failed: 'Ký thất bại',
  ManualReview: 'Cần kiểm tra tại nhà cung cấp',
  Requested: 'Chờ Owner duyệt',
  Approved: 'Đã duyệt trả phòng',
  Inspected: 'Đã kiểm tra',
  PendingSettlement: 'Chờ quyết toán',
  Settled: 'Đã xác minh quyết toán',
  Completed: 'Đã hoàn tất',
  contract_not_pending_activation: 'Hợp đồng chưa ở bước chờ kích hoạt.',
  location_not_active: 'Location chưa hoạt động.',
  room_not_available: 'Phòng chưa sẵn sàng.',
  signed_terms_changed: 'Nội dung hợp đồng không khớp bản đã đưa đi ký.',
  contract_not_in_effective_period: 'Chưa đến hoặc đã qua kỳ hiệu lực.',
  verified_signature_evidence_required: 'Cần đủ bằng chứng ký đã xác minh của Owner và Tenant.',
  verified_residents_required: 'Cần xác minh tất cả người ở và người đại diện.',
  invalid_contract_signers: 'Tài khoản bên ký chưa hợp lệ.',
  security_deposit_insufficient: 'Tiền cọc đã xác minh chưa đủ.',
  room_contract_conflict: 'Phòng có hợp đồng đang xung đột.',
  financial_ledger_and_deposit_policy:
    'Chờ đối chiếu nghĩa vụ, cọc và giao dịch thực tế; chưa đủ điều kiện giải phóng phòng.',
  contract_not_ready_for_activation:
    'Chưa đủ điều kiện kích hoạt. Hãy tải lại điều kiện từ máy chủ.',
  bank_transaction_already_allocated: 'Giao dịch ngân hàng đã được phân bổ. Hãy kiểm tra sao kê.',
  idempotency_key_reused: 'Nội dung thao tác đã thay đổi. Hãy tải lại và kiểm tra.',
  contract_concurrent_or_duplicate_operation: 'Có thao tác trùng hoặc đồng thời. Hãy tải lại.',
  renewal_already_pending: 'Đã có bản gia hạn đang chờ.',
  contract_not_renewable: 'Hợp đồng chưa thể gia hạn hoặc đang có yêu cầu trả phòng.',
  confirmed_final_readings_required:
    'Cần chỉ số điện và nước chốt đã xác nhận, đúng hợp đồng và ngày kiểm tra.',
  move_out_not_ready_for_inspection:
    'Cần duyệt yêu cầu, đặt lịch và đến ngày trả phòng trước khi lập biên bản.',
  settlement_unresolved: 'Nghĩa vụ quyết toán chưa hoàn tất hoặc đã thay đổi.',
  move_out_not_settled: 'Chưa thể đóng hợp đồng: kiểm tra quyết toán và ngày biên bản.',
  signer_already_requested: 'Đã có yêu cầu ký. Hãy kiểm tra trạng thái trước khi thử lại.',
  previous_signature_pending: 'Bên ký trước chưa hoàn tất. Hãy chờ xác minh.',
  inspection_evidence_not_available: 'Ảnh không thuộc người lập biên bản hoặc đã được sử dụng.',
  inspection_upload_not_allowed: 'Chưa được tải ảnh hoặc đã đủ 5 ảnh.',
  invalid_contract_period_or_residents: 'Kiểm tra kỳ thuê, người đại diện và danh sách người ở.',
};
export const text = (value: string) =>
  labels[value] ?? 'Trạng thái hoặc điều kiện cần kiểm tra với Owner';
export function contractError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError')
    return 'Đã dừng chờ phản hồi. Hãy tải lại trước khi thử lại.';
  const e = error as { status?: number; code?: string; problem?: { code?: string } } | null;
  const code = e?.code ?? e?.problem?.code;
  if (code && labels[code]) return labels[code];
  return (
    (
      {
        0: 'Không kết nối được máy chủ. Kết quả thao tác chưa được xác nhận. Hãy tải lại trước khi thử lại.',
        400: 'Dữ liệu chưa hợp lệ. Kiểm tra các trường và ngày thực hiện.',
        401: 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.',
        403: 'Bạn không có quyền thực hiện thao tác này.',
        404: 'Hợp đồng hoặc tài nguyên không khả dụng trong phạm vi của bạn.',
        409: 'Dữ liệu đã thay đổi hoặc chưa đủ điều kiện. Hãy tải lại trước khi thử lại.',
        413: 'Ảnh vượt quá 5 MB.',
        503: 'Dịch vụ ký hoặc thành phần xử lý chưa sẵn sàng. Hãy kiểm tra trạng thái trước khi thử lại.',
      } as Record<number, string>
    )[e?.status ?? 0] ?? 'Chưa xác nhận thành công. Hãy tải lại để kiểm tra.'
  );
}
export function formatContractMoney(value: string) {
  if (!/^\d+$/.test(value)) return '—';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(BigInt(value));
}
export function dateOnly(value: string): string {
  const iso = /^\d{2}\/\d{2}\/\d{4}$/.test(value) ? value.split('/').reverse().join('-') : value;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(iso) ||
    iso.startsWith('0000-') ||
    !Number.isFinite(Date.parse(iso)) ||
    new Date(iso + 'T00:00:00Z').toISOString().slice(0, 10) !== iso
  )
    throw new Error('Ngày không hợp lệ. Nhập dd/MM/yyyy.');
  return iso;
}
export const displayContractDate = (value: string) => value.split('-').reverse().join('/');
export function businessToday() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day']
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join('-');
}
export function localSchedule(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error('Nhập lịch theo yyyy-MM-ddTHH:mm, giờ Việt Nam.');
  dateOnly(value.slice(0, 10));
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14)) > 59)
    throw new Error('Giờ không hợp lệ.');
  const instant = new Date(value + ':00+07:00');
  if (instant.getTime() < Date.now()) throw new Error('Lịch kiểm tra không được trong quá khứ.');
  return instant.toISOString();
}
export function vnd(value: string, positive = false) {
  if (!/^(0|[1-9]\d{0,17})$/.test(value) || (positive && value === '0'))
    throw new Error('Nhập số nguyên VND hợp lệ, tối đa 18 chữ số.');
  return value;
}
export function guid(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ||
    /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)
  )
    throw new Error('Mã định danh phải là UUID hợp lệ.');
  return value;
}
function required(value: string, max: number) {
  if (!value.trim() || value.trim().length > max)
    throw new Error(`Nội dung bắt buộc, tối đa ${max} ký tự.`);
  return value.trim();
}
export interface ActionField {
  name: string;
  label: string;
  type?: 'date' | 'money' | 'multiline' | 'schedule' | 'certificate';
  max?: number;
}
export interface ContractAction {
  operation: string;
  label: string;
  fields: ActionField[];
  warning: string;
}
const action = (
  operation: string,
  label: string,
  fields: ActionField[] = [],
  warning = 'Máy chủ sẽ kiểm tra lại quyền và điều kiện trước khi lưu.',
): ContractAction => ({ operation, label, fields, warning });
const proposedFields: ActionField[] = [
  { name: 'proposedDate', label: 'Ngày dự kiến trả phòng', type: 'date' },
  { name: 'reason', label: 'Lý do', type: 'multiline', max: 2000 },
];
export function contractActions(
  c: ContractView,
  m: MoveOut | null,
  role: string,
  actorId: string,
): ContractAction[] {
  const owner = role === 'Owner',
    staff = role === 'Staff',
    tenant = role === 'Tenant' && c.tenantUserId === actorId;
  const signer = (owner || tenant) && (c.ownerSignerId === actorId || c.tenantUserId === actorId);
  const active = c.status === 'Active',
    waiting = ['Draft', 'PendingSigning', 'PendingActivation'].includes(c.status);
  const mine = c.signatures.filter((s) => s.signerUserId === actorId);
  const open = c.signatures.some((s) => !['Signed', 'Failed'].includes(s.status));
  const result: ContractAction[] = [];
  if (
    signer &&
    ['Draft', 'PendingSigning'].includes(c.status) &&
    !mine.some((s) => s.status !== 'Failed') &&
    !open
  )
    result.push(
      action(
        'signing',
        'Yêu cầu ký MySign',
        [{ name: 'certificateId', label: 'Chứng thư của bạn', type: 'certificate' }],
        'Hãy đọc kỹ điều khoản. Xác nhận ký trên ứng dụng của nhà cung cấp. Gửi yêu cầu chưa đồng nghĩa đã ký hoặc kích hoạt.',
      ),
    );
  if (signer && mine.some((s) => s.status === 'Pending'))
    result.push(action('signing/sync', 'Kiểm tra kết quả ký'));
  if (signer && mine.some((s) => ['Dispatching', 'ManualReview'].includes(s.status)))
    result.push(
      action(
        'signing/recover',
        'Khôi phục tham chiếu ký',
        [
          {
            name: 'providerReference',
            label: 'Mã giao dịch đã kiểm tra tại nhà cung cấp',
            max: 200,
          },
        ],
        'Chỉ nhập mã đã đối chiếu với nhà cung cấp. Sau khôi phục vẫn phải kiểm tra kết quả ký.',
      ),
    );
  if (owner && waiting)
    result.push(
      action(
        'activate',
        'Kích hoạt hợp đồng',
        [],
        'Chỉ kích hoạt khi đủ chữ ký, cọc, người ở và kỳ hiệu lực. Phòng chuyển sang đang thuê sau khi máy chủ xác nhận.',
      ),
    );
  if (
    owner &&
    !c.previousContractId &&
    !['Terminated', 'Superseded', 'Cancelled'].includes(c.status)
  )
    result.push(
      action(
        'deposit-verifications',
        'Xác minh cọc ngân hàng',
        [
          { name: 'bankTransactionReference', label: 'Mã giao dịch trên sao kê', max: 150 },
          { name: 'amount', label: 'Số tiền cọc đã nhận (VND)', type: 'money' },
          {
            name: 'verificationReason',
            label: 'Căn cứ đối chiếu sao kê',
            type: 'multiline',
            max: 2000,
          },
        ],
        'Chỉ xác minh giao dịch đã đối chiếu sao kê ngân hàng. Ảnh chuyển khoản riêng lẻ chưa đủ chứng minh tiền đã về.',
      ),
    );
  if ((owner || staff) && active && !m)
    result.push(
      action(
        'renewals',
        'Chuẩn bị gia hạn',
        [
          { name: 'endDate', label: 'Ngày hết hạn mới', type: 'date' },
          { name: 'monthlyRent', label: 'Tiền thuê kỳ mới (VND)', type: 'money' },
          { name: 'terms', label: 'Điều khoản gia hạn', type: 'multiline', max: 12000 },
        ],
        'Tạo phiên bản mới để hai bên ký. Hợp đồng hiện tại giữ nguyên đến khi Owner kích hoạt bản gia hạn.',
      ),
    );
  if (owner && c.kind === 'Renewal' && waiting)
    result.push(
      action(
        'renewal-cancellation',
        'Hủy bản gia hạn',
        [],
        'Hủy bản gia hạn đang chờ; giữ nguyên hợp đồng gốc và lịch sử.',
      ),
    );
  if (active && !m && tenant)
    result.push(
      action(
        'termination-requests',
        'Yêu cầu chấm dứt trước hạn',
        proposedFields,
        'Owner cần duyệt yêu cầu. Gửi yêu cầu chưa kết thúc hợp đồng hoặc giải phóng phòng.',
      ),
    );
  if (active && !m && owner)
    result.push(action('expiry-move-out', 'Lập yêu cầu trả phòng khi hết hạn', proposedFields));
  if (owner && m?.status === 'Requested')
    result.push(action('move-out/approve', 'Duyệt yêu cầu trả phòng'));
  if ((owner || staff) && m?.status === 'Approved')
    result.push(
      action('move-out/schedule', 'Đặt lịch kiểm tra', [
        { name: 'scheduledAt', label: 'Lịch kiểm tra (giờ Việt Nam)', type: 'schedule' },
      ]),
    );
  if (staff && m?.status === 'Approved' && m.inspectionScheduledAt)
    result.push(
      action(
        'move-out/inspection',
        'Lưu biên bản trả phòng',
        [
          { name: 'electricityReadingId', label: 'Mã chỉ số điện chốt đã xác nhận' },
          { name: 'waterReadingId', label: 'Mã chỉ số nước chốt đã xác nhận' },
          {
            name: 'notes',
            label: 'Hiện trạng phòng, tài sản, chìa khóa',
            type: 'multiline',
            max: 4000,
          },
        ],
        'Cần đến ngày trả phòng, đủ ảnh hiện trạng và chỉ số chốt đúng hợp đồng/ngày kiểm tra.',
      ),
    );
  if (owner && m && ['Inspected', 'PendingSettlement', 'Settled'].includes(m.status))
    result.push(
      action(
        'move-out/settlement',
        'Ghi nhận xem xét quyết toán',
        [
          {
            name: 'decision',
            label: 'Quyết định và căn cứ của Owner',
            type: 'multiline',
            max: 2000,
          },
        ],
        'Lưu quyết định vào lịch sử. Chỉ đánh dấu đã quyết toán khi máy chủ đối chiếu đầy đủ nghĩa vụ, cọc và giao dịch thực tế.',
      ),
    );
  if (owner && m?.status === 'Settled')
    result.push(
      action(
        'move-out/complete',
        'Hoàn tất trả phòng',
        [{ name: 'actualEndDate', label: 'Ngày kết thúc thực tế', type: 'date' }],
        'Máy chủ kiểm tra lại quyết toán trước khi kết thúc hợp đồng và giải phóng phòng. Ngày phải trùng ngày lập biên bản.',
      ),
    );
  return result;
}
export function actionPayload(
  a: ContractAction,
  values: Record<string, string>,
  c: ContractView,
  evidenceIds: string[] = [],
): Record<string, unknown> | undefined {
  if (!a.fields.length) return undefined;
  const body: Record<string, unknown> = {};
  for (const f of a.fields) {
    const value = values[f.name] ?? '';
    body[f.name] =
      f.type === 'date'
        ? dateOnly(value)
        : f.type === 'money'
          ? vnd(value, true)
          : f.type === 'schedule'
            ? localSchedule(value)
            : f.name.endsWith('Id')
              ? guid(value)
              : required(value, f.max ?? 200);
  }
  if (a.operation === 'renewals' && String(body.endDate) <= c.endDate)
    throw new Error('Ngày hết hạn mới phải sau ngày hết hạn hiện tại.');
  if (a.operation === 'termination-requests' || a.operation === 'expiry-move-out') {
    if (String(body.proposedDate) < businessToday())
      throw new Error('Ngày trả phòng không được trong quá khứ.');
    if (a.operation === 'termination-requests' && String(body.proposedDate) >= c.endDate)
      throw new Error('Yêu cầu trước hạn cần ngày trả phòng trước ngày hết hạn.');
    if (a.operation === 'expiry-move-out' && String(body.proposedDate) < c.endDate)
      throw new Error('Trả phòng hết hạn cần ngày từ ngày hết hạn trở đi.');
  }
  if (a.operation === 'move-out/inspection') {
    if (!evidenceIds.length || evidenceIds.length > 5)
      throw new Error('Cần từ 1 đến 5 ảnh hiện trạng đã tải lên.');
    body.evidenceIds = evidenceIds.map(guid);
  }
  return body;
}
export function draftPayload(values: Record<string, string>, residentIds: string[]) {
  const startDate = dateOnly(values.startDate ?? ''),
    endDate = dateOnly(values.endDate ?? '');
  if (endDate <= startDate) throw new Error('Ngày hết hạn phải sau ngày bắt đầu.');
  if (
    !residentIds.length ||
    residentIds.length > 50 ||
    !residentIds.includes(values.representativeResidentId)
  )
    throw new Error('Chọn người ở và một người đại diện trong danh sách.');
  return {
    roomId: guid(values.roomId ?? ''),
    ownerSignerId: guid(values.ownerSignerId ?? ''),
    tenantUserId: guid(values.tenantUserId ?? ''),
    representativeResidentId: guid(values.representativeResidentId),
    residentIds: residentIds.map(guid),
    startDate,
    endDate,
    monthlyRent: vnd(values.monthlyRent ?? '', true),
    requiredDeposit: vnd(values.requiredDeposit ?? ''),
    terms: required(values.terms ?? '', 12000),
    holdingContractId: values.holdingContractId ? guid(values.holdingContractId) : null,
  };
}
// Retain the same key after an ambiguous response. Forget only once the server confirms success.
export function mutationKeys(newKey: () => string) {
  const keys = new Map<string, string>();
  const fingerprint = (scope: string, body: unknown) => JSON.stringify([scope, body]);
  return {
    get(scope: string, body: unknown) {
      const f = fingerprint(scope, body);
      let k = keys.get(f);
      if (!k) {
        k = newKey();
        keys.set(f, k);
      }
      return k;
    },
    confirmed(scope: string, body: unknown) {
      keys.delete(fingerprint(scope, body));
    },
  };
}
