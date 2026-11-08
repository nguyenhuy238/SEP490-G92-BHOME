import { useMemo } from 'react';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { createApiClient } from '../../../../../packages/client-core/src/api';
import { getApiBaseUrl } from '../../../../../packages/client-core/src/config';

export type TaskStatus = 'Assigned' | 'InProgress' | 'PendingVerification' | 'Completed' | 'Cancelled';
export interface OperationalTask {
  id: string; locationId: string; kind: 'AdHoc' | 'MeterReading'; title: string;
  requirements: string; priority: 'Normal' | 'High'; dueAt: string | null;
  evidenceRequired: boolean; status: TaskStatus; isOverdue: boolean;
  currentResponsibleStaffUserId: string | null; recordedStaffUserId: string | null;
  responsibilityAvailable: boolean; result: string | null; version: number;
  verifiedByUserId: string | null; verifiedAt: string | null; createdAt: string; updatedAt: string;
}
export interface TaskPage<T> { items: T[]; page: number; pageSize: number; totalCount: number }
export interface TaskHistory {
  id: string; actorId: string; action: string; note: string; responsibleStaffUserId: string | null;
  occurredAt: string; wasOverdue: boolean; taskVersion: number;
}
export interface TaskEvidence {
  id: string; contentType: string; length: number; uploadedByUserId: string;
  createdAt: string; submissionId: string | null;
}
export interface TaskWork {
  title: string; requirements: string; priority: 'Normal' | 'High'; dueAt: string; evidenceRequired: boolean;
}
export type OwnerTaskAction = 'assign' | 'coordinate' | 'verify' | 'rework' | 'cancel';

export function useOperationalTasksApi() {
  const { client } = useAuth();
  return useMemo(() => {
    const request = createApiClient(
      getApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.DEV),
      () => client.session?.accessToken,
      client.clear,
      client.refresh,
    );
    const command = <T,>(path: string, body: unknown, key: string, method = 'POST') =>
      request<T>(path, { method, body: JSON.stringify(body), headers: { 'Idempotency-Key': key } });
    const path = (id: string) => `/api/v1/operational-tasks/${encodeURIComponent(id)}`;
    return {
      list: (query: string, signal?: AbortSignal) =>
        request<TaskPage<OperationalTask>>(`/api/v1/operational-tasks?${query}`, { signal }),
      get: (id: string, signal?: AbortSignal) => request<OperationalTask>(path(id), { signal }),
      history: (id: string, signal?: AbortSignal) =>
        request<TaskPage<TaskHistory>>(`${path(id)}/history?page=1&pageSize=100`, { signal }),
      evidence: (id: string, signal?: AbortSignal) =>
        request<TaskEvidence[]>(`${path(id)}/evidence`, { signal }),
      evidenceFile: (id: string, evidenceId: string) =>
        request<Blob>(`${path(id)}/evidence/${encodeURIComponent(evidenceId)}`, {}, 'blob'),
      create: (locationId: string, work: TaskWork, key: string) =>
        command<OperationalTask>('/api/v1/operational-tasks', { locationId, work }, key),
      update: (id: string, version: number, work: TaskWork, reason: string, key: string) =>
        command<OperationalTask>(path(id), { version, work, reason }, key, 'PUT'),
      act: (id: string, action: OwnerTaskAction, version: number, note: string, key: string) =>
        command<OperationalTask>(`${path(id)}/${action}`, { version, note, evidenceIds: [] }, key),
    };
  }, [client]);
}
