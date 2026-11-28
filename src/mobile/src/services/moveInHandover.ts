import {
  guid,
  type ContractClient,
  type HandoverAsset,
  type HandoverReading,
} from '../../../../packages/client-core/src/contracts';
import { NO_CERTIFICATE, type SigningOtpView } from '../../../../packages/client-core/src/signing';
import type { MoveInInventory, MoveInInventoryItem } from './moveInInventory';

export type MoveInDraftStatus =
  | 'Draft'
  | 'PendingOwnerReview'
  | 'ReinspectionRequested'
  | 'Ready'
  | 'ChangesRequested'
  | 'Confirmed';

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
  notes: string | null;
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
  inventoryTaskId?: string | null;
  inventoryStatus?: 'Assigned' | 'InProgress' | 'Completed' | 'Cancelled' | null;
}

export interface MoveInChangeRequest {
  id: string;
  version: number;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  createdAt: string;
  decisionReason?: string | null;
}

export interface MoveInReinspectionItem {
  kind: string;
  code?: string | null;
  assetId?: string | null;
  rechecked?: boolean;
  readingId?: string | null;
}

export interface MoveInReinspectionRecord {
  version: number;
  reason: string;
  ownerId: string;
  requestedAt: string;
  items: MoveInReinspectionItem[];
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
  inspectedAssets?:
    | {
        id: string;
        name: string;
        expectedQuantity: number;
        actualQuantity: number;
        condition: string;
        notes?: string | null;
      }[]
    | null;
  roomCondition: string;
  keysAndAccess: string;
  notes: string;
  evidenceIds: string[];
  roomChecks: MoveInRoomCheck[];
  accessItems: MoveInAccessItem[];
  keyEvidenceIds?: string[];
  outstandingIssues: MoveInOutstandingIssue[];
  moveInTask?: MoveInWorkTask | null;
  inventoryToken?: string | null;
  noAssetsConfirmed: boolean;
  ownerReadyAt?: string | null;
  staffSubmittedAt?: string | null;
  ownerSignedAt?: string | null;
  ownerDocumentId?: string | null;
  ownerDocumentHash?: string | null;
  tenantSignedAt?: string | null;
  reinspectionItems?: MoveInReinspectionItem[];
  reinspectionHistory?: MoveInReinspectionRecord[];
  tenantSigningPending?: boolean;
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
  keyEvidenceIds?: string[];
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
    get: (id: string, signal?: AbortSignal) => request<MoveInDraft>(endpoint(id), { signal }),
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
    submit: (id: string, version: number, key: string) => mutate(id, '/submit', { version }, key),
    resubmit: (id: string, version: number, key: string) =>
      mutate(id, '/resubmit', { version }, key),
    startTenantSigning: (id: string, version: number, key: string) =>
      mutate(
        id,
        '/tenant-sign',
        {
          version,
          signature: { certificateId: NO_CERTIFICATE, method: 'OTP', usePicture: true },
        },
        key,
      ),
    signTenantInSession: (
      id: string,
      version: number,
      ink: { width: number; height: number; strokes: number[][][] },
      note: string,
      key: string,
    ) =>
      mutate(id, '/tenant-sign/session', { version, consent: true, ink, note: note.trim() }, key),
    tenantSigningOtp: (id: string, signal?: AbortSignal) =>
      request<SigningOtpView>(`${endpoint(id)}/tenant-sign/otp`, { signal }),
    resendTenantSigningOtp: (id: string) =>
      request<SigningOtpView>(`${endpoint(id)}/tenant-sign/otp/resend`, { method: 'POST' }),
    confirmTenantSigning: (id: string, version: number, code: string, note: string, key: string) =>
      mutate(
        id,
        '/tenant-sign/otp/confirm',
        { version, code: code.trim(), note: note.trim() },
        key,
      ),
    requestCorrection: (id: string, version: number, reason: string, key: string) =>
      mutate(id, '/requests', { version, reason: reason.trim() }, key),
    confirm: (id: string, version: number, note: string, key: string) =>
      mutate(id, '/tenant-confirmation', { version, note: note.trim() }, key),
  };
}

export function hasCompleteRoomInspection(value: MoveInDraft): boolean {
  return (
    (value.evidenceIds ?? []).length > 0 &&
    roomHandoverChecks.every(({ code }) => {
      const matches = (value.roomChecks ?? []).filter((check) => check.code === code);
      if (matches.length !== 1) return false;
      const check = matches[0]!;
      return (
        (check.status === 'Passed' ||
          check.status === 'NotApplicable' ||
          check.status === 'Issue') &&
        (check.status === 'NotApplicable' || (check.evidenceIds ?? []).length > 0)
      );
    })
  );
}

function hasCompleteAssetInspection(value: MoveInDraft): boolean {
  return (
    value.noAssetsConfirmed ||
    (value.assets.length > 0 &&
      value.assets.every((asset) => asset.checked && (asset.evidenceIds ?? []).length > 0))
  );
}

export function hasSavedInventoryItem(item: MoveInInventoryItem, completed = false): boolean {
  return (
    item.condition !== null &&
    item.actualQuantity !== null &&
    (completed || item.actualQuantity === 0 || (item.evidenceIds ?? []).length > 0)
  );
}

export function hasCompleteAssetSection(
  value: MoveInDraft,
  inventory: MoveInInventory | null,
): boolean {
  if (!value.moveInTask?.inventoryTaskId) return hasCompleteAssetInspection(value);
  return (
    inventory?.status === 'Completed' &&
    inventory.contractId === value.contractId &&
    inventory.items.length === value.assets.length &&
    value.assets.every((asset) =>
      inventory.items.some((item) => item.id === asset.id && hasSavedInventoryItem(item, true)),
    )
  );
}

export function firstUnfinishedStep(
  value: MoveInDraft,
  inventory: MoveInInventory | null = null,
): number {
  if (!value.electricity || !value.water) return 0;
  if (!hasCompleteRoomInspection(value)) return 1;
  if (!hasCompleteAssetSection(value, inventory)) return 2;
  return 3;
}

export function canTenantRespondToMoveIn(draft: MoveInDraft | null): boolean {
  return draft?.status === 'Ready' && draft.missing.length === 0;
}

export function canStaffEditMoveIn(draft: MoveInDraft | null): boolean {
  return (
    (draft?.status === 'Draft' || draft?.status === 'ReinspectionRequested') &&
    draft.moveInTask?.status === 'InProgress' &&
    draft.moveInTask.canInspect === true
  );
}

export function moveInReinspectionLabel(item: MoveInReinspectionItem, draft: MoveInDraft): string {
  if (item.kind === 'RoomCheck')
    return (
      roomHandoverChecks.find((check) => check.code === item.code)?.label ?? 'Hiện trạng phòng'
    );
  if (item.kind === 'Asset')
    return draft.assets.find((asset) => asset.id === item.assetId)?.name ?? 'Tài sản bàn giao';
  if (item.kind === 'Meter') return item.code === 'Water' ? 'Công tơ nước' : 'Công tơ điện';
  if (item.kind === 'Access') return 'Chìa khóa bàn giao';
  if (item.kind === 'Room') return 'Hiện trạng tổng quan';
  return 'Nội dung bàn giao';
}

const missingMessages: Record<string, string> = {
  contract_active: 'Hợp đồng chưa được kích hoạt.',
  tenant_account: 'Chưa có tài khoản khách thuê cho hợp đồng.',
  electricity: 'Chưa có chỉ số điện khởi tạo đã xác nhận.',
  water: 'Chưa có chỉ số nước khởi tạo đã xác nhận.',
  meter_readings_same_day: 'Chỉ số điện và nước phải được xác nhận cùng ngày bàn giao.',
  room_condition: 'Chưa ghi nhận hiện trạng phòng.',
  keys_and_access: 'Chưa ghi nhận số lượng chìa khóa bàn giao.',
  room_evidence: 'Chưa có ảnh bằng chứng hiện trạng phòng.',
  assets: 'Chưa kiểm kê đầy đủ các nhóm tài sản.',
  asset_quantities_or_evidence:
    'Số lượng, tình trạng hoặc ảnh bằng chứng tài sản chưa hợp lệ; nhân viên cần kiểm tra lại.',
  inventory_changed: 'Danh sách tài sản đã thay đổi; cần tải lại và kiểm kê theo danh sách mới.',
  staff_inspection: 'Nhân viên chưa lưu kết quả kiểm tra bàn giao.',
  room_checklist: 'Chưa hoàn thành đủ 7 nhóm kiểm tra hiện trạng phòng.',
  room_summary_evidence: 'Hiện trạng chung cần ảnh minh chứng.',
  room_check_evidence: 'Hạng mục Đạt hoặc Có vấn đề cần ảnh minh chứng.',
  key_evidence: 'Chưa có ảnh chìa khóa.',
  room_issue_evidence: 'Mục có vấn đề cần ảnh bằng chứng trực tiếp.',
  access_inventory: 'Chưa ghi nhận số lượng chìa khóa bàn giao.',
  outstanding_issues: 'Vấn đề tồn đọng cần chủ trọ xem xét và quyết định phương án xử lý.',
  handover_task_not_started: 'Bấm Bắt đầu công việc trước khi kiểm kê và ghi nhận hiện trạng.',
  handover_task: 'Nhiệm vụ bàn giao chưa sẵn sàng. Hãy nhờ chủ trọ kiểm tra.',
  contract_changed: 'Thông tin hợp đồng đã thay đổi; cần cập nhật biên bản.',
};

export function moveInMissingMessage(code: string): string {
  return (
    missingMessages[code] ??
    'Còn điều kiện bàn giao chưa đạt; vui lòng tải lại hoặc liên hệ chủ trọ.'
  );
}
