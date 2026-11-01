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
  kind: 'AdHoc' | 'MeterReading';
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
};
// UI affordances only. The server rechecks role, current assignment, version and state.
export function availableTaskActions(
  task: OperationalTask,
  role: string,
  actorId: string,
): TaskAction[] {
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
    upload: (id: string, bytes: Uint8Array<ArrayBuffer>, key: string) =>
      api.request<TaskEvidence>(`${path(id)}/evidence`, {
        method: 'PUT',
        body: bytes,
        headers: { 'Content-Type': 'image/jpeg', 'Idempotency-Key': guid(key) },
      }),
    notifications: (page: number, signal?: AbortSignal) =>
      api.request<TaskPage<TaskNotification>>(`${root}/notifications?page=${page}&pageSize=20`, {
        signal,
      }),
    read: (id: string) =>
      api.request<void>(`${root}/notifications/${guid(id)}/read`, { method: 'POST' }),
  };
}
