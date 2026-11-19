import { guid, type ContractClient, type HandoverAsset, type HandoverReading } from '../../../../packages/client-core/src/contracts';

export type MoveInDraftStatus = 'Draft' | 'Ready' | 'ChangesRequested' | 'Confirmed';

export const roomHandoverChecks = [
  { code: 'walls_ceiling_floor', label: 'Tường, trần và sàn' },
  { code: 'doors_windows_locks', label: 'Cửa, cửa sổ và ổ khóa' },
  { code: 'electrical_lighting_outlets', label: 'Hệ thống điện, đèn và ổ cắm' },
  { code: 'water_plumbing_drainage', label: 'Hệ thống nước và thoát nước' },
  { code: 'bathroom_toilet', label: 'Phòng tắm và nhà vệ sinh' },
  { code: 'cleanliness', label: 'Vệ sinh phòng' },
  { code: 'safety_equipment', label: 'Thiết bị an toàn' },
] as const;

export type MoveInRoomCheckCode = (typeof roomHandoverChecks)[number]['code'];
export type MoveInRoomCheckStatus = 'Passed' | 'Issue' | 'NotApplicable';

export const moveInAccessKinds = [
  { type: 'RoomKey', label: 'Chìa khóa phòng' },
  { type: 'GateKey', label: 'Chìa khóa cổng' },
  { type: 'AccessCard', label: 'Thẻ ra vào' },
  { type: 'Remote', label: 'Điều khiển từ xa' },
  { type: 'DigitalAccess', label: 'Quyền truy cập số' },
  { type: 'Other', label: 'Vật dụng / quyền khác' },
] as const;

export type MoveInAccessType = (typeof moveInAccessKinds)[number]['type'];

export interface MoveInRoomCheck {
  code: string;
  status: MoveInRoomCheckStatus;
  notes: string;
  evidenceIds: string[];
}

export interface MoveInAccessItem {
  type: MoveInAccessType;
  quantity: number;
  notes: string;
}

export interface MoveInOutstandingIssue {
  code: string;
  description: string;
  responsibleParty: string;
  dueDate: string | null;
}

export interface MoveInWorkTask {
  id: string;
  version: number;
  status: 'Assigned' | 'InProgress' | 'PendingVerification' | 'Completed' | 'Cancelled';
  canInspect: boolean;
}

export interface MoveInChangeRequest {
  id: string;
  version: number;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  createdAt: string;
  decisionReason?: string | null;
}

export interface MoveInDraft {
  version: number;
  status: MoveInDraftStatus;
  contractId: string;
  roomNumber: string;
  locationName: string;
  locationAddress: string;
  startDate: string;
  endDate: string;
  monthlyRent: number;
  requiredDeposit: number;
  terms: string;
  electricity: HandoverReading | null;
  water: HandoverReading | null;
  assets: HandoverAsset[];
  roomCondition: string;
  keysAndAccess: string;
  notes: string;
  evidenceIds: string[];
  roomChecks: MoveInRoomCheck[];
  accessItems: MoveInAccessItem[];
  outstandingIssues: MoveInOutstandingIssue[];
  moveInTask?: MoveInWorkTask | null;
  inventoryToken?: string | null;
  noAssetsConfirmed: boolean;
  ownerReadyAt?: string | null;
  tenantConfirmedAt?: string | null;
  requests: MoveInChangeRequest[];
  missing: string[];
}

export interface MoveInDraftInput {
  version: number;
  roomCondition?: string;
  keysAndAccess?: string;
  notes?: string;
  assets?: {
    id: string;
    condition: string;
    observedQuantity?: number;
    handedOverQuantity?: number;
    goodQuantity?: number;
    wornQuantity?: number;
    damagedQuantity?: number;
    missingQuantity?: number;
    checked?: boolean;
    notes?: string;
    evidenceIds?: string[];
    physicalObservations?: {
      id: string;
      quantity: number;
      condition: string;
      handedOverQuantity?: number;
    }[];
  }[];
  evidenceIds?: string[];
  inventoryToken?: string | null;
  roomChecks?: MoveInRoomCheck[];
  accessItems?: MoveInAccessItem[];
  outstandingIssues?: MoveInOutstandingIssue[];
}

const endpoint = (id: string) => `/api/v1/contracts/${guid(id)}/handover/draft`;

export function moveInHandover(api: ContractClient) {
  const request = api.transport;
  const mutate = (id: string, suffix: string, body: object, key: string) =>
    request<MoveInDraft>(`${endpoint(id)}${suffix}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': guid(key) },
      body: JSON.stringify(body),
    });
  return {
    get: (id: string, signal?: AbortSignal) =>
      request<MoveInDraft>(endpoint(id), { signal }),
    uploadEvidence: (id: string, bytes: BodyInit, contentType: 'image/png' | 'image/jpeg') =>
      request<{ id: string }>(`${endpoint(id)}/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: bytes,
      }),
    save: (id: string, body: MoveInDraftInput, key: string) => mutate(id, '', body, key),
    beginWork: (task: MoveInWorkTask, key: string) =>
      request<unknown>(`/api/v1/operational-tasks/${guid(task.id)}/start`, {
        method: 'POST',
        headers: { 'Idempotency-Key': guid(key) },
        body: JSON.stringify({ version: task.version }),
      }),
    requestCorrection: (id: string, version: number, reason: string, key: string) =>
      mutate(id, '/requests', { version, reason: reason.trim() }, key),
    confirm: (id: string, version: number, note: string, key: string) =>
      mutate(id, '/tenant-confirmation', { version, note: note.trim() }, key),
  };
}

export function canTenantRespondToMoveIn(draft: MoveInDraft | null): boolean {
  return draft?.status === 'Ready' && draft.missing.length === 0;
}

export function canStaffEditMoveIn(draft: MoveInDraft | null): boolean {
  return draft?.status === 'Draft' &&
    draft.moveInTask?.status === 'InProgress' &&
    draft.moveInTask.canInspect === true;
}

const missingMessages: Record<string, string> = {
  contract_active: 'Hợp đồng chưa được kích hoạt.',
  tenant_account: 'Chưa có tài khoản Tenant cho hợp đồng.',
  electricity: 'Chưa có chỉ số điện khởi tạo đã xác nhận.',
  water: 'Chưa có chỉ số nước khởi tạo đã xác nhận.',
  meter_readings_same_day: 'Chỉ số điện và nước phải được xác nhận cùng ngày bàn giao.',
  room_condition: 'Chưa ghi nhận hiện trạng phòng.',
  keys_and_access: 'Chưa ghi nhận chìa khóa và quyền ra vào.',
  room_evidence: 'Chưa có ảnh bằng chứng hiện trạng phòng.',
  assets: 'Chưa kiểm kê đầy đủ các nhóm tài sản.',
  asset_quantities_or_evidence: 'Số lượng, tình trạng hoặc ảnh bằng chứng tài sản chưa hợp lệ; Staff cần kiểm tra lại.',
  inventory_changed: 'Danh sách tài sản đã thay đổi; cần tải lại và kiểm kê theo danh sách mới.',
  staff_inspection: 'Staff chưa lưu kết quả kiểm tra bàn giao.',
  room_checklist: 'Chưa hoàn thành đủ 7 nhóm kiểm tra hiện trạng phòng.',
  room_issue_evidence: 'Mục có vấn đề cần ghi chú và gắn ảnh bằng chứng trực tiếp.',
  access_inventory: 'Chưa kê khai số lượng chìa khóa, thẻ hoặc quyền truy cập bàn giao.',
  outstanding_issues: 'Vấn đề tồn đọng cần người chịu trách nhiệm, nội dung và hạn xử lý.',
  handover_task_not_started: 'Bấm Bắt đầu công việc trước khi kiểm kê và ghi nhận hiện trạng.',
  handover_task: 'Nhiệm vụ bàn giao chưa sẵn sàng. Hãy nhờ Owner kiểm tra.',
  contract_changed: 'Thông tin hợp đồng đã thay đổi; cần cập nhật biên bản.',
};

export function moveInMissingMessage(code: string): string {
  return missingMessages[code] ?? 'Còn điều kiện bàn giao chưa đạt; vui lòng tải lại hoặc liên hệ Owner.';
}
