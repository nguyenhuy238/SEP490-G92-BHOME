import { guid } from '../../../../packages/client-core/src/contracts';
import type { MobileApi } from '../lib/api';

export interface TaskPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}
export interface OperationalTask {
  id: string;
  locationId: string;
  kind: 'AdHoc' | 'MeterReading' | 'MoveInInventory' | 'LocationAssetHandover';
  title: string;
  requirements: string;
  priority: 'Normal' | 'High';
  dueAt: string | null;
  evidenceRequired: boolean;
  status: 'Assigned' | 'InProgress' | 'PendingVerification' | 'Completed' | 'Cancelled';
  isOverdue: boolean;
  currentResponsibleStaffUserId: string | null;
  responsibilityAvailable: boolean;
  result: string | null;
  version: number;
  verifiedAt: string | null;
  target?: {
    roomId: string | null;
    assetId: string | null;
    commonArea: string | null;
    label: string;
    contractId?: string | null;
  } | null;
}
// Main handover is one Staff work card. The historical pre-move-in inventory
// checkpoint is reached from its Assets section, not a parallel queue item.
export function isEmbeddedMoveInInventory(task: OperationalTask): boolean {
  return task.kind === 'MoveInInventory' && !!task.target?.contractId;
}

export function isEmbeddedInitialMeterTask(task: OperationalTask): boolean {
  // Contract-created Initial tasks are still genuine capture records, but not
  // standalone items in the Staff general-work queue. Routine meter work stays.
  return (
    task.kind === 'MeterReading' && /^Chụp chỉ số (?:điện|nước) khi nhận phòng\s/u.test(task.title)
  );
}

export function isMainMoveInWork(task: OperationalTask): boolean {
  return (
    task.kind === 'AdHoc' &&
    !!task.target?.contractId &&
    task.title.startsWith('Bàn giao vào phòng')
  );
}

/** A contract's move-out inspection is entered through the shared Staff work queue. */
export function isMainMoveOutWork(task: OperationalTask): boolean {
  return (
    task.kind === 'AdHoc' &&
    !!task.target?.contractId &&
    task.title.startsWith('Kiểm tra trả phòng')
  );
}
export interface TaskHistory {
  id: string;
  action: string;
  note: string;
  occurredAt: string;
  taskVersion: number;
}
export interface TaskEvidence {
  id: string;
  contentType: string;
  length: number;
  createdAt: string;
  submissionId: string | null;
}
export interface TaskNotification {
  id: string;
  taskId: string;
  event: string;
  createdAt: string;
  readAt: string | null;
}
export interface TaskWork {
  title: string;
  requirements: string;
  priority: 'Normal' | 'High';
  dueAt: string;
  evidenceRequired: boolean;
}
export type TaskAction =
  | 'start'
  | 'progress'
  | 'blockers'
  | 'submit'
  | 'verify'
  | 'rework'
  | 'coordinate'
  | 'cancel'
  | 'assign';
const root = '/api/v1/operational-tasks';
export const taskStatusLabels = {
  Assigned: 'Cần làm',
  InProgress: 'Đang xử lý',
  PendingVerification: 'Chờ Owner kiểm tra',
  Completed: 'Hoàn thành',
  Cancelled: 'Đã hủy',
};
export const taskActionLabels: Record<string, string> = {
  created: 'Tạo công việc',
  updated: 'Cập nhật yêu cầu',
  start: 'Bắt đầu',
  progress: 'Cập nhật tiến độ',
  blockers: 'Báo vướng mắc',
  submit: 'Gửi kết quả cho Owner',
  verify: 'Xác nhận hoàn thành',
  rework: 'Yêu cầu làm lại',
  coordinate: 'Ghi hướng dẫn phối hợp',
  cancel: 'Hủy công việc',
  assign: 'Đồng bộ phân công',
  responsibility_changed: 'Cập nhật phân công',
  evidence_uploaded: 'Tải ảnh kết quả',
  location_asset_inventory_created: 'Tạo kiểm kê tài sản toàn cơ sở',
  location_asset_inventory_item_checked: 'Cập nhật xác nhận tài sản',
  location_asset_handover_approved: 'Owner đã duyệt biên bản',
  location_asset_handover_owner_signed: 'Owner đã ký xác nhận',
  location_asset_handover_rework_requested: 'Owner yêu cầu kiểm tra lại',
  location_asset_handover_completed: 'Hai bên hoàn tất ký bàn giao',
};
// UI affordances only. The server rechecks role, current assignment, version and state.
export function availableTaskActions(
  task: OperationalTask,
  role: string,
  actorId: string,
): TaskAction[] {
  if (task.kind === 'LocationAssetHandover') {
    if (role !== 'Staff' || task.currentResponsibleStaffUserId !== actorId) return [];
    if (task.status === 'Assigned') return ['start'];
    // Explicit submission is retained only as a compatibility action for ready legacy inventory.
    if (task.status === 'InProgress') return ['progress', 'blockers', 'submit'];
    return [];
  }
  if (task.kind !== 'AdHoc') return [];
  if (role === 'Staff' && task.currentResponsibleStaffUserId === actorId) {
    if (task.status === 'Assigned') return ['start'];
    if (task.status === 'InProgress') return ['progress', 'blockers', 'submit'];
  }
  if (role === 'Owner' && !['Completed', 'Cancelled'].includes(task.status)) {
    return [
      ...(task.status === 'PendingVerification' ? (['verify', 'rework'] as const) : []),
      'coordinate',
      'assign',
      'cancel',
    ];
  }
  return [];
}
export function operationalTasks(api: MobileApi) {
  const path = (id: string) => `${root}/${guid(id)}`;
  const command = <T>(url: string, body: unknown, key: string, method = 'POST') =>
    api.request<T>(url, {
      method,
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': guid(key) },
    });
  return {
    list: (page: number, status = '', signal?: AbortSignal) =>
      api.request<TaskPage<OperationalTask>>(
        `${root}?page=${page}&pageSize=20${status ? `&status=${encodeURIComponent(status)}` : ''}`,
        { signal },
      ),
    get: (id: string, signal?: AbortSignal) => api.request<OperationalTask>(path(id), { signal }),
    history: (id: string, page: number, signal?: AbortSignal) =>
      api.request<TaskPage<TaskHistory>>(`${path(id)}/history?page=${page}&pageSize=20`, {
        signal,
      }),
    evidence: (id: string, signal?: AbortSignal) =>
      api.request<TaskEvidence[]>(`${path(id)}/evidence`, { signal }),
    image: (id: string, evidenceId: string, signal?: AbortSignal) =>
      api.request<Blob>(`${path(id)}/evidence/${guid(evidenceId)}`, { signal }, 'blob'),
    imageBytes: (id: string, evidenceId: string, signal?: AbortSignal) =>
      api.request<Uint8Array<ArrayBuffer>>(
        `${path(id)}/evidence/${guid(evidenceId)}`,
        { signal },
        'bytes',
      ),
    act: (
      id: string,
      action: TaskAction,
      version: number,
      note: string,
      evidenceIds: string[],
      key: string,
    ) => command<OperationalTask>(`${path(id)}/${action}`, { version, note, evidenceIds }, key),
    create: (locationId: string, work: TaskWork, key: string) =>
      command<OperationalTask>(root, { locationId: guid(locationId), work }, key),
    update: (id: string, version: number, work: TaskWork, reason: string, key: string) =>
      command<OperationalTask>(path(id), { version, work, reason }, key, 'PUT'),
    upload: (
      id: string,
      bytes: Uint8Array<ArrayBuffer>,
      key: string,
      contentType: 'image/jpeg' | 'image/png' = 'image/jpeg',
    ) =>
      api.request<TaskEvidence>(`${path(id)}/evidence`, {
        method: 'PUT',
        body: bytes,
        headers: { 'Content-Type': contentType, 'Idempotency-Key': guid(key) },
      }),
    notifications: (page: number, signal?: AbortSignal) =>
      api.request<TaskPage<TaskNotification>>(`${root}/notifications?page=${page}&pageSize=20`, {
        signal,
      }),
    read: (id: string) =>
      api.request<void>(`${root}/notifications/${guid(id)}/read`, { method: 'POST' }),
  };
}
