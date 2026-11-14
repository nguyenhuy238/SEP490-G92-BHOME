// IncidentContracts.cs: read enums are names; write enums use numeric values.
import { formatContractMoney } from '../../../../../packages/client-core/src/contracts';
export function formatIncidentMoney(value: number | null | undefined) {
  if (value == null) return 'Chưa có';
  return Number.isSafeInteger(value) && value >= 0
    ? formatContractMoney(String(value))
    : 'Cần đối chiếu số tiền trên chứng từ.';
}
export interface Incident {
  id: string;
  code: string;
  locationId: string;
  roomId: string | null;
  assetId: string | null;
  commonArea: string | null;
  description: string;
  severity: string;
  status: string;
  type: string | null;
  category: string | null;
  acknowledgedAt: string | null;
  resolutionNote: string | null;
  version: number;
  staffAvailable: boolean | null;
  escalationEnabled: boolean;
  createdAt: string;
}
export interface WorkOrder {
  id: string;
  incidentId: string;
  locationId: string;
  roomId: string | null;
  assetId: string | null;
  assignedStaffId: string;
  expectedOutcome: string;
  targetCompletionAt: string;
  isOverdue: boolean;
  status: string;
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
export interface IncidentEvidence {
  id: string;
  kind: string;
  workOrderId: string | null;
  activityId: string | null;
  contentType?: string;
  length: number;
}
export const incidentStatuses: Record<string, string> = {
  Submitted: 'Mới báo cáo',
  InProgress: 'Đang xử lý',
  Resolved: 'Đã giải quyết',
  Rejected: 'Đã từ chối',
  Duplicate: 'Trùng báo cáo',
  Cancelled: 'Đã hủy',
};
export const workStatuses: Record<string, string> = {
  Assigned: 'Đã giao',
  PendingApproval: 'Chờ duyệt phương án',
  InProgress: 'Đang sửa chữa',
  PendingVerification: 'Chờ xác minh',
  Verified: 'Đã xác minh',
  Cancelled: 'Đã hủy',
};
export const statusText = (value: string) =>
  ({ ...incidentStatuses, ...workStatuses })[value] ?? value;
