import type { MobileApi } from '../lib/api';
import { MobileApiError, errorMessage } from '../lib/api';

// IncidentContracts.cs / IncidentRecords.cs. Work Orders are not Operational Tasks.
export const incidentRoot = '/api/v1/incidents';
export const workOrderRoot = '/api/v1/work-orders';
export type IncidentStatus =
  'Submitted' | 'InProgress' | 'Resolved' | 'Rejected' | 'Duplicate' | 'Cancelled';
export type WorkStatus =
  'Assigned' | 'PendingApproval' | 'InProgress' | 'PendingVerification' | 'Verified' | 'Cancelled';
export type EvidenceKind = 'Report' | 'EmergencyAction' | 'Inspection' | 'Completion' | 'Direct';
export interface IncidentPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}
export interface Incident {
  id: string;
  code: string;
  locationId: string;
  roomId: string | null;
  commonArea: string | null;
  assetId: string | null;
  description: string;
  severity: 'Normal' | 'Emergency';
  status: IncidentStatus;
  type: string | null;
  category: string | null;
  acknowledgedAt: string | null;
  resolutionNote: string | null;
  version: number;
  createdAt: string;
  staffAvailable: boolean | null;
  escalationEnabled: boolean;
}
export interface WorkOrder {
  id: string;
  incidentId: string | null;
  source?: 'Incident' | 'Proactive';
  description?: string;
  commonArea?: string | null;
  usesMaterials?: boolean;
  fastRepairPolicyVersion?: number | null;
  fastRepairCategory?: string | null;
  assetProposalPending?: boolean;
  proposedAssetId?: string | null;
  proposedAssetName?: string | null;
  proposedAssetCategory?: string | null;
  proposedAssetCondition?: string | null;
  locationId: string;
  roomId: string | null;
  assetId: string | null;
  assignedStaffId: string;
  expectedOutcome: string;
  targetCompletionAt: string;
  isOverdue: boolean;
  status: WorkStatus;
  inspectionResult: string | null;
  proposedSolution: string | null;
  estimatedMinutes: number | null;
  estimatedCost: number | null;
  vendor: string | null;
  proposalVersion: number;
  planApproved: boolean;
  canStart: boolean;
  approvedById: string | null;
  approvedAt: string | null;
  result: string | null;
  actualCost: number | null;
  verifiedById: string | null;
  verifiedAt: string | null;
  version: number;
}
export interface IncidentActivity {
  id: string;
  workOrderId: string | null;
  action: string;
  note: string;
  occurredAt: string;
  actorId: string | null;
  dataJson: string | null;
}
export interface IncidentEvidence {
  id: string;
  workOrderId: string | null;
  activityId: string | null;
  kind: EvidenceKind;
  contentType: string;
  length: number;
}
export interface EmergencyAction {
  id: string;
  activityId: string;
  requestedCost: number | null;
  costApproved: boolean | null;
}
export interface MaintenanceHistory {
  id: string;
  activityId: string;
  action: string;
  incidentId: string | null;
  workOrderId: string | null;
  roomId: string | null;
  assetId: string | null;
  conditionBefore: string | null;
  conditionAfter: string | null;
  statusBefore: string | null;
  statusAfter: string | null;
  actualCost: number;
  verifiedById: string;
  verifiedAt: string;
}
export interface IncidentExpense {
  id: string;
  incidentId: string | null;
  workOrderId: string | null;
  emergencyActionId: string | null;
  category: string;
  amount: number;
  expenseDate: string;
}
export interface IncidentNotification {
  id: string;
  incidentId: string | null;
  workOrderId?: string | null;
  event: string;
  highPriority: boolean;
  createdAt: string;
  readAt: string | null;
  deliveryState: string;
}
export interface ReportingRoom {
  roomId: string;
  roomNumber: string;
  locationId: string;
  locationName: string;
}
export interface ReportingAsset {
  assetId: string;
  name: string;
  category: string;
  status: string;
  locationId: string;
  roomId: string | null;
  commonArea: string | null;
}
export interface IncidentResult {
  incidentId: string | null;
  workOrderId: string | null;
  resourceId: string | null;
}
export interface IncidentSubmit {
  locationId: string;
  roomId: string | null;
  commonArea: string | null;
  assetId: string | null;
  severity: 'Normal' | 'Emergency';
  description: string;
}
export interface IncidentCommands {
  review: { version: number; type: string; category: string };
  reject: IncidentDecision;
  duplicate: IncidentDecision;
  cancel: IncidentDecision;
  resolve: IncidentDecision;
  'work-orders': {
    version: number;
    staffId: string;
    expectedOutcome: string;
    targetCompletionAt: string;
  };
  'direct-completion': {
    version: number;
    actualCost: number;
    result: string;
    evidenceIds: string[];
    assetCondition: string | null;
    assetStatus: number;
  };
  acknowledge: { version: number };
  'emergency-actions': {
    version: number;
    note: string;
    evidenceIds: string[];
    requestedCost: number | null;
  };
}
export interface IncidentDecision {
  version: number;
  reason: string;
  duplicateOfId?: string | null;
  assetStatus?: number | null;
  assetCondition?: string | null;
}
export interface WorkCommands {
  'fast-repair-start': {
    version: number;
    category: string;
    inspectionResult: string;
    solution: string;
    estimatedMinutes: number;
    estimatedCost: number;
    usesMaterials: boolean;
  };
  'fast-repair-fallback': WorkAction;
  'asset-proposal': {
    version: number;
    assetId: string | null;
    name: string | null;
    category: string | null;
    condition: string | null;
    reason: string;
  };
  'asset-decision': { version: number; approve: boolean; reason: string };
  reassign: { version: number; staffId: string; reason: string };
  proposal: {
    version: number;
    inspectionResult: string;
    solution: string;
    estimatedMinutes: number;
    estimatedCost: number | null;
    evidenceIds: string[];
    usesMaterials?: boolean;
  };
  'plan-decision': {
    version: number;
    approve: boolean;
    reason: string | null;
    vendor: string | null;
  };
  start: WorkAction;
  progress: WorkAction;
  blocker: WorkAction;
  submit: WorkAction;
  rework: WorkAction;
  verify: {
    version: number;
    actualCost: number;
    result: string;
    costVarianceReason: string | null;
    assetCondition: string | null;
    assetStatus: number;
  };
  cancel: IncidentDecision;
}
export interface WorkAction {
  version: number;
  note?: string;
  evidenceIds?: string[];
}
export interface IncidentPhoto {
  id: string;
  bytes: Uint8Array<ArrayBuffer>;
  contentType: 'image/png' | 'image/jpeg';
}
export interface IncidentFilter {
  page?: number;
  pageSize?: number;
  locationId?: string;
  roomId?: string;
  assetId?: string;
  incidentId?: string;
  status?: string;
  severity?: string;
  workOrderStatus?: string;
}
export function incidentQuery(filter: IncidentFilter = {}) {
  const q = new URLSearchParams({
    page: String(filter.page ?? 1),
    pageSize: String(filter.pageSize ?? 20),
  });
  Object.entries(filter).forEach(([key, value]) => {
    if (value !== undefined && value !== '') q.set(key, String(value));
  });
  return q.toString();
}
export function validateIncidentPhoto(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > 5_000_000)
    return 'Ảnh phải có dữ liệu và không vượt quá 5.000.000 byte.';
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return png || jpeg ? '' : 'Chỉ nhận ảnh PNG hoặc JPEG. Máy chủ sẽ kiểm tra nội dung ảnh.';
}
function utf8(value: string) {
  return Uint8Array.from(encodeURIComponent(value).match(/%[\da-f]{2}|[^%]/gi) ?? [], (part) =>
    part[0] === '%' ? parseInt(part.slice(1), 16) : part.charCodeAt(0),
  );
}
// Raw multipart bytes work with the existing native/web authenticated transport.
// Do not serialize FormData as JSON, and never send file:// URIs or object keys.
export function incidentMultipart(input: IncidentSubmit, photos: IncidentPhoto[], key: string) {
  if (photos.length > 5) throw new Error('Chỉ gửi tối đa 5 ảnh.');
  const boundary = 'bhome-' + key;
  const chunks: Uint8Array[] = [];
  const fields = {
    locationId: input.locationId,
    roomId: input.roomId,
    commonArea: input.commonArea,
    assetId: input.assetId,
    severity: input.severity === 'Emergency' ? 1 : 0,
    description: input.description,
  };
  for (const [name, value] of Object.entries(fields)) {
    if (value !== null)
      chunks.push(
        utf8(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
      );
  }
  photos.forEach((photo, index) => {
    const error = validateIncidentPhoto(photo.bytes);
    if (error) throw new Error(error);
    chunks.push(
      utf8(
        `--${boundary}\r\nContent-Disposition: form-data; name="images"; filename="evidence-${index}.${photo.contentType === 'image/png' ? 'png' : 'jpg'}"\r\nContent-Type: ${photo.contentType}\r\n\r\n`,
      ),
      photo.bytes,
      utf8('\r\n'),
    );
  });
  chunks.push(utf8(`--${boundary}--\r\n`));
  const body = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
const evidenceKinds: Record<EvidenceKind, number> = {
  Report: 0,
  EmergencyAction: 1,
  Inspection: 2,
  Completion: 3,
  Direct: 4,
};
export function incidentClient(api: Pick<MobileApi, 'request'>) {
  const post = (path: string, input: unknown, key: string, signal?: AbortSignal) =>
    api.request<IncidentResult>(path, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(input),
      signal,
    });
  return {
    list: (filter: IncidentFilter, signal?: AbortSignal) =>
      api.request<IncidentPage<Incident>>(`${incidentRoot}?${incidentQuery(filter)}`, { signal }),
    get: (id: string, signal?: AbortSignal) =>
      api.request<Incident>(`${incidentRoot}/${id}`, { signal }),
    submit: async (
      input: IncidentSubmit,
      photos: IncidentPhoto[],
      key: string,
      signal?: AbortSignal,
    ) => {
      const { body, contentType } = incidentMultipart(input, photos, key);
      const result = await api.request<IncidentResult>(incidentRoot, {
        method: 'POST',
        body,
        headers: { 'Content-Type': contentType, 'Idempotency-Key': key },
        signal,
      });
      if (!result.incidentId)
        throw new Error('Máy chủ chưa trả mã báo cáo. Tải lại để kiểm tra trước khi gửi lại.');
      return { ...result, incidentId: result.incidentId };
    },
    command: <K extends keyof IncidentCommands>(
      id: string,
      action: K,
      input: IncidentCommands[K],
      key: string,
      signal?: AbortSignal,
    ) => post(`${incidentRoot}/${id}/${action}`, input, key, signal),
    workCommand: <K extends keyof WorkCommands>(
      id: string,
      action: K,
      input: WorkCommands[K],
      key: string,
      signal?: AbortSignal,
    ) => post(`${workOrderRoot}/${id}/${action}`, input, key, signal),
    costDecision: (
      id: string,
      entryId: string,
      input: { version: number; approve: boolean; reason: string },
      key: string,
      signal?: AbortSignal,
    ) =>
      post(`${incidentRoot}/${id}/emergency-actions/${entryId}/cost-decision`, input, key, signal),
    upload: (
      id: string | null,
      workOrderId: string | null,
      kind: EvidenceKind,
      photo: IncidentPhoto,
      key: string,
      signal?: AbortSignal,
    ) =>
      api.request<IncidentResult>(
        workOrderId && !id
          ? `${workOrderRoot}/${workOrderId}/evidence?kind=${evidenceKinds[kind]}`
          : `${incidentRoot}/${id}/evidence?kind=${evidenceKinds[kind]}${workOrderId ? '&workOrderId=' + workOrderId : ''}`,
        {
          method: 'PUT',
          body: photo.bytes,
          headers: { 'Content-Type': photo.contentType, 'Idempotency-Key': key },
          signal,
        },
      ),
    evidence: (
      id: string | null,
      imageId: string,
      signal?: AbortSignal,
      workOrderId?: string | null,
    ) =>
      api.request<Uint8Array<ArrayBuffer>>(
        workOrderId
          ? `${workOrderRoot}/${workOrderId}/evidence/${imageId}`
          : `${incidentRoot}/${id}/evidence/${imageId}`,
        { signal },
        'bytes',
      ),
    readNotification: (id: string) =>
      api.request<void>(`${incidentRoot}/notifications/${id}/read`, { method: 'POST' }),
  };
}
export const incidentLabels: Record<string, string> = {
  Pending: 'Đang chờ chuyển',
  Failed: 'Chuyển thông báo thất bại',
  Delivered: 'Đã chuyển thông báo',
  Suppressed: 'Đã ngừng chuyển theo quyền truy cập',
  Normal: 'Thông thường',
  Emergency: 'Khẩn cấp',
  Submitted: 'Đã tiếp nhận báo cáo',
  InProgress: 'Đang xử lý',
  Resolved: 'Đã giải quyết',
  Rejected: 'Đã từ chối',
  Duplicate: 'Báo cáo trùng',
  Cancelled: 'Đã hủy',
  Assigned: 'Đã phân công',
  PendingApproval: 'Chờ duyệt phương án',
  PendingVerification: 'Chờ nghiệm thu',
  Verified: 'Đã nghiệm thu',
  Report: 'Ảnh báo cáo',
  EmergencyAction: 'Ảnh xử lý khẩn cấp',
  Inspection: 'Ảnh kiểm tra',
  Completion: 'Ảnh kết quả',
  Direct: 'Ảnh xử lý trực tiếp',
  submitted: 'Gửi báo cáo',
  reviewed: 'Phân loại báo cáo',
  assigned: 'Phân công sửa chữa',
  acknowledged: 'Tiếp nhận khẩn cấp',
  emergency_action: 'Hành động khẩn cấp',
  emergency_cost_decided: 'Quyết định chi phí khẩn cấp',
  reassigned: 'Đổi người phụ trách',
  proposal_submitted: 'Gửi phương án',
  plan_approved: 'Duyệt phương án',
  plan_rejected: 'Từ chối phương án',
  start: 'Bắt đầu sửa chữa',
  progress: 'Cập nhật tiến độ',
  blocker: 'Báo vướng mắc',
  submit: 'Gửi kết quả nghiệm thu',
  verified: 'Owner nghiệm thu',
  rework: 'Yêu cầu làm lại',
  work_order_cancelled: 'Hủy lệnh sửa chữa',
  direct_completed: 'Hoàn tất xử lý trực tiếp',
  resolved: 'Giải quyết sự cố',
  reject: 'Từ chối báo cáo',
  duplicate: 'Đánh dấu trùng',
  cancel: 'Hủy báo cáo',
  resolve: 'Đóng sự cố',
  evidence_uploaded: 'Tải ảnh minh chứng',
  Active: 'Hoạt động',
  NeedsRepair: 'Cần sửa',
  UnderRepair: 'Đang sửa',
  Retired: 'Ngừng sử dụng',
};
export function incidentText(value: string) {
  return incidentLabels[value] ?? value;
}
export function incidentError(error: unknown) {
  const codes: Record<string, string> = {
    invalid_incident_text: 'Kiểm tra nội dung bắt buộc và giới hạn ký tự của thao tác.',
    invalid_incident_scope_or_evidence: 'Chọn đúng một phòng hoặc tên khu vực chung; tối đa 5 ảnh.',
    invalid_incident_evidence:
      'Ảnh không còn đúng loại, người tải hoặc lần thao tác. Hãy tải lại dữ liệu.',
    incident_evidence_limit:
      'Đã đạt giới hạn ảnh cho loại bằng chứng này. Không tự tải lại bằng mã thao tác mới.',
    invalid_vnd_amount: 'Số tiền phải là số nguyên VND không âm và trong giới hạn cho phép.',
    invalid_target_completion: 'Hạn hoàn thành phải có múi giờ và nằm trong tương lai.',
    invalid_estimated_time: 'Nhập thời gian sửa chữa dự kiến từ 1 phút.',
    invalid_duplicate_reference:
      'Báo cáo gốc phải cùng cơ sở, phòng/khu vực và tài sản, ở trạng thái hợp lệ.',
    incident_resource_not_found: 'Hồ sơ không khả dụng hoặc ngoài phạm vi được phép truy cập.',
    asset_outcome_required: 'Owner cần chọn trạng thái tài sản sau xử lý.',
    invalid_asset_outcome: 'Chọn trạng thái tài sản: hoạt động, cần sửa hoặc ngừng sử dụng.',
    asset_has_open_work: 'Tài sản còn lệnh sửa chữa mở; chưa được ngừng sử dụng.',
    asset_retired: 'Tài sản đã ngừng sử dụng; không thể tiếp tục luồng này.',
    work_order_not_in_progress: 'Chỉ cập nhật tiến độ khi lệnh sửa chữa đang thực hiện.',
    work_order_closed: 'Lệnh sửa chữa đã kết thúc.',
    acknowledgement_required: 'Staff cần tiếp nhận khẩn cấp trước khi ghi hành động.',
    already_acknowledged: 'Sự cố đã được tiếp nhận. Hãy tải lại trạng thái.',
    emergency_required: 'Thao tác này chỉ dùng cho sự cố khẩn cấp.',
    evidence_not_allowed_in_state: 'Trạng thái hiện tại chưa cho phép tải loại ảnh này.',
    cost_not_pending: 'Khoản chi phí đã có quyết định hoặc không có khoản đề nghị.',
    approval_decision_required: 'Chọn phê duyệt hoặc từ chối.',
    existing_work_requires_verification:
      'Sự cố có lệnh sửa chữa cần nghiệm thu; không thể xử lý trực tiếp.',
    work_order_verification_required: 'Cần hoàn tất nghiệm thu lệnh sửa chữa trước khi đóng sự cố.',
    verified_work_cannot_be_rejected:
      'Đã có lệnh sửa chữa được nghiệm thu; không thể từ chối hoặc đánh dấu trùng.',
    reporter_cannot_cancel_after_owner_decision:
      'Người báo không được hủy sau khi Owner đã quyết định.',
    stale_version: 'Dữ liệu đã thay đổi. Tải lại và xem phiên bản mới trước khi gửi lại.',
    idempotency_conflict: 'Mã thao tác đã được dùng với dữ liệu khác. Tải lại để kiểm tra kết quả.',
    completion_evidence_required: 'Cần ít nhất một ảnh kết quả cho lần gửi nghiệm thu này.',
    cost_receipt_required: 'Chi phí khẩn cấp cần ảnh minh chứng.',
    owner_classification_required: 'Owner cần phân loại sự cố trước khi giao hoặc xử lý trực tiếp.',
    staff_unavailable: 'Nhân viên không còn được phân công tại cơ sở này.',
    fast_repair_category_inactive:
      'Nhóm sửa nhanh chưa được Owner kích hoạt. Gửi phương án thông thường để được duyệt.',
    fast_repair_requires_normal_approval:
      'Công việc cần chi phí hoặc vật tư. Dừng sửa nhanh và gửi phương án để Owner duyệt.',
    asset_link_unavailable:
      'Tài sản đã được liên kết hoặc đề xuất chưa sẵn sàng. Tải lại lệnh sửa chữa.',
    asset_proposal_pending: 'Owner cần quyết định đề xuất tài sản trước khi nghiệm thu.',
    incident_closed: 'Sự cố đã đóng; không thể tiếp tục cập nhật.',
    invalid_work_order_transition: 'Trạng thái không cho phép thao tác này. Hãy tải lại.',
    report_evidence_locked: 'Báo cáo đã được xử lý; không thể thêm ảnh báo cáo.',
    emergency_cost_decision_required: 'Cần quyết định các chi phí khẩn cấp còn chờ duyệt.',
    open_work_orders_require_cancellation:
      'Cần xử lý các lệnh sửa chữa còn mở trước khi đóng báo cáo.',
  };
  const base =
    error instanceof MobileApiError
      ? errorMessage(error)
      : error instanceof Error
        ? error.message
        : 'Thao tác chưa thành công.';
  return error instanceof MobileApiError && error.code && codes[error.code]
    ? `${codes[error.code]} ${base}`
    : base;
}
export function workActions(work: WorkOrder, role: string, actor: string): (keyof WorkCommands)[] {
  if (role === 'Owner')
    return [
      ...(!['Verified', 'Cancelled'].includes(work.status)
        ? (['reassign', 'cancel'] as const)
        : []),
      ...(work.status === 'PendingApproval' && !work.planApproved
        ? (['plan-decision'] as const)
        : []),
      ...(work.status === 'PendingVerification' ? (['verify', 'rework'] as const) : []),
      ...(work.assetProposalPending ? (['asset-decision'] as const) : []),
    ];
  if (role !== 'Staff' || work.assignedStaffId !== actor) return [];
  return [
    ...(work.status === 'Assigned' ? (['fast-repair-start'] as const) : []),
    ...(work.status === 'InProgress' && work.fastRepairPolicyVersion
      ? (['fast-repair-fallback'] as const)
      : []),
    ...(!['Verified', 'Cancelled'].includes(work.status) &&
    !work.assetId &&
    !work.assetProposalPending
      ? (['asset-proposal'] as const)
      : []),
    ...(['Assigned', 'PendingApproval'].includes(work.status) ? (['proposal'] as const) : []),
    ...(work.canStart ? (['start'] as const) : []),
    ...(work.status === 'InProgress' ? (['progress', 'blocker', 'submit'] as const) : []),
  ];
}
