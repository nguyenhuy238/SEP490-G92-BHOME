import type {
  HandoverAsset,
  HandoverReading,
} from '../../../../../../../packages/client-core/src/contracts';

interface HandoverChangeRequest {
  id: string;
  version: number;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  createdAt: string;
  decisionReason?: string | null;
}

interface HandoverRoomCheck {
  code: string;
  status: 'Passed' | 'Issue' | 'NotApplicable';
  notes: string;
  evidenceIds: string[];
}

interface HandoverAccessItem {
  type: string;
  quantity: number;
  notes: string;
}

interface HandoverOutstandingIssue {
  code: string;
  description: string;
  responsibleParty: string;
  dueDate: string | null;
}

type ReinspectionKind = 'Room' | 'RoomCheck' | 'Asset' | 'Access' | 'Meter';
interface ReinspectionItem {
  kind: ReinspectionKind;
  code?: string;
  assetId?: string;
  rechecked?: boolean;
}

interface ReinspectionRecord {
  version: number;
  reason: string;
  ownerId: string;
  requestedAt: string;
  items: ReinspectionItem[];
}

export interface ReinspectionOption {
  key: string;
  label: string;
  issue: boolean;
  item: ReinspectionItem;
}

export const roomCheckLabels: Record<string, string> = {
  walls_ceiling_floor: 'Tường, trần, sàn',
  doors_windows_locks: 'Cửa, cửa sổ, khóa',
  electrical_lighting_outlets: 'Đèn, công tắc, ổ điện',
  water_plumbing_drainage: 'Cấp nước, vòi, thoát nước',
  bathroom_toilet: 'Nhà vệ sinh và thiết bị vệ sinh',
  cleanliness: 'Vệ sinh và hiện trạng phòng',
  safety_equipment: 'Thiết bị an toàn được trang bị',
};

/** GET /api/v1/contracts/{id}/handover/draft; kept local to Owner Web. */
export interface OwnerHandoverDraft {
  version: number;
  /** Explicit server capability: older builds ignore `ink` in Owner Ready. */
  ownerInkSigningSupported?: boolean;
  status:
    | 'Draft'
    | 'PendingOwnerReview'
    | 'ReinspectionRequested'
    | 'Ready'
    | 'ChangesRequested'
    | 'Confirmed';
  contractId: string;
  roomNumber: string;
  locationName: string;
  locationAddress: string;
  startDate: string;
  endDate: string;
  monthlyRent: number | string;
  requiredDeposit: number | string;
  terms: string;
  electricity: HandoverReading | null;
  water: HandoverReading | null;
  assets: HandoverAsset[];
  /** Completed Staff inventory snapshot for Owner. IDs are authorized reinspection targets. */
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
  keyEvidenceIds?: string[];
  inventoryToken?: string | null;
  noAssetsConfirmed: boolean;
  inventoryHasIssues?: boolean;
  staffPreparedAt?: string | null;
  staffSubmittedAt?: string | null;
  staffSubmittedBy?: string | null;
  ownerSignedAt?: string | null;
  reinspectionItems?: ReinspectionItem[];
  reinspectionHistory?: ReinspectionRecord[];
  tenantSignedAt?: string | null;
  ownerReadyReason?: string | null;
  ownerHandlingPlan?: string | null;
  ownerDocumentId?: string | null;
  moveInTask?: {
    id: string;
    status: string;
    version?: number;
    canInspect?: boolean;
    inventoryTaskId: string | null;
    inventoryStatus: string | null;
  } | null;
  ownerReadyAt?: string | null;
  tenantConfirmedAt?: string | null;
  requests: HandoverChangeRequest[];
  missing: string[];
  roomChecks?: HandoverRoomCheck[];
  accessItems?: HandoverAccessItem[];
  outstandingIssues?: HandoverOutstandingIssue[];
}

export const statusLabel: Record<OwnerHandoverDraft['status'], string> = {
  Draft: 'Đang kiểm tra bàn giao',
  PendingOwnerReview: 'Chờ chủ trọ duyệt biên bản',
  ReinspectionRequested: 'Đang chờ nhân viên kiểm tra lại',
  Ready: 'Chờ khách thuê ký biên bản',
  ChangesRequested: 'Khách thuê yêu cầu chỉnh sửa',
  Confirmed: 'Đã xác nhận bàn giao',
};

export function reinspectionOptions(draft: OwnerHandoverDraft): ReinspectionOption[] {
  const checks: ReinspectionOption[] = Object.entries(roomCheckLabels).map(([code, label]) => {
    const current = draft.roomChecks?.find((check) => check.code === code);
    return {
      key: `RoomCheck:${code}`,
      label: `${label} · ${current?.status === 'Issue' ? 'Có vấn đề' : current?.status === 'NotApplicable' ? 'Không áp dụng · Cần xác minh' : current ? 'Đạt' : 'Chưa kiểm tra'}`,
      issue: current?.status !== 'Passed',
      item: { kind: 'RoomCheck', code },
    };
  });
  const assets: ReinspectionOption[] = draft.inspectedAssets
    ? draft.inspectedAssets.map((asset) => ({
        key: `Asset:${asset.id}`,
        label: `Tài sản: ${asset.name}`,
        issue: asset.condition !== 'Good' || asset.actualQuantity !== asset.expectedQuantity,
        item: { kind: 'Asset' as const, assetId: asset.id },
      }))
    : (draft.noAssetsConfirmed ? [] : (draft.assets ?? [])).map((asset) => ({
        key: `Asset:${asset.id}`,
        label: `Tài sản: ${asset.name}`,
        issue:
          !asset.checked ||
          (asset.missingQuantity ?? 0) > 0 ||
          (asset.damagedQuantity ?? 0) > 0 ||
          (asset.wornQuantity ?? 0) > 0 ||
          (asset.configuredQuantity != null && asset.observedQuantity !== asset.configuredQuantity),
        item: { kind: 'Asset' as const, assetId: asset.id },
      }));
  return [
    {
      key: 'Room',
      label: 'Hiện trạng chung và ảnh phòng',
      issue: draft.missing?.includes('room_summary_evidence') ?? !draft.evidenceIds?.length,
      item: { kind: 'Room' },
    },
    ...checks,
    ...assets,
    {
      key: 'Access:RoomKey',
      label: 'Chìa khóa và vật dụng ra vào',
      issue: !draft.accessItems?.some((item) => item.type === 'RoomKey' && item.quantity > 0),
      item: { kind: 'Access', code: 'RoomKey' },
    },
  ];
}

export function reinspectionLabel(item: ReinspectionItem, draft: OwnerHandoverDraft): string {
  return (
    reinspectionOptions(draft).find(
      (option) =>
        option.item.kind === item.kind &&
        option.item.code === item.code &&
        option.item.assetId === item.assetId,
    )?.label ??
    item.code ??
    (item.kind === 'Asset' ? 'Tài sản' : item.kind)
  );
}

/** Whole-number meter display only; raw confirmed readings remain unchanged. */
export function displayMeterInteger(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return 'chưa có';
  const numeric = Number(value);
  return Number.isFinite(numeric) && Number.isSafeInteger(Math.trunc(numeric))
    ? Math.trunc(numeric).toLocaleString('vi-VN')
    : String(value).split('.')[0];
}

// Identify factual issues for reinspection guidance, never as an Owner override.
export function requiresOwnerException(draft: OwnerHandoverDraft): boolean {
  if (draft.inventoryHasIssues) return true;
  if (draft.roomChecks?.some((check) => check.status === 'Issue')) return true;
  if (draft.noAssetsConfirmed) return false;
  if (!draft.assets?.length) return true;
  return draft.assets.some(
    (asset) =>
      !asset.ownerChecked ||
      (asset.missingQuantity ?? 0) > 0 ||
      (asset.damagedQuantity ?? 0) > 0 ||
      (asset.observedQuantity != null &&
        (asset.observedQuantity !==
          (asset.physicalAssets?.reduce((total, physical) => total + physical.quantity, 0) ?? 0) ||
          (asset.handedOverQuantity != null && asset.handedOverQuantity < asset.observedQuantity))),
  );
}
