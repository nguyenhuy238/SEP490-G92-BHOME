import type { LifecyclePolicy, RecordPage } from './assetLifecycle';
import type { SetupDocument, SetupRequest } from './propertySetup';

export interface InspectionAnswer {
  unitId: string;
  checklistCode: string;
  result: string;
  note: string | null;
  evidenceIds: string[];
}
export interface EquipmentInspection {
  assetId: string;
  scheduleId: string;
  period: string;
  taskId: string;
  policyId: string;
  policyVersion: number;
  policySnapshot: LifecyclePolicy;
  units: { id: string; version: number; label: string; position: string }[];
  quantitySnapshot: number;
  answers: InspectionAnswer[];
  outcome: string;
  reviewNote: string | null;
  remediationWorkOrderId: string | null;
  progress: {
    total: number;
    inspected: number;
    passed: number;
    failed: number;
    notInspected: number;
    outcome: string;
  } | null;
}
export interface InspectionSchedule {
  assetId: string;
  policyId: string;
  policyVersion: number;
  startsOn: string;
  intervalDays: number | null;
  completionWindowDays: number;
  enabled: boolean;
  expectedVersion?: number;
}
export const inspectionLabels: Record<string, string> = {
  Draft: 'Đang ghi nhận',
  Submitted: 'Chờ xác minh',
  Verified: 'Đã xác minh',
  Passed: 'Đạt',
  Failed: 'Không đạt',
  Incomplete: 'Chưa kiểm tra đủ',
  NotInspected: 'Chưa kiểm tra',
  NotApplicable: 'Không áp dụng',
};
export function initialInspectionAnswers(data: EquipmentInspection): InspectionAnswer[] {
  return data.units.flatMap((unit) =>
    data.policySnapshot.checklist.map(
      (item) =>
        data.answers.find(
          (answer) => answer.unitId === unit.id && answer.checklistCode === item.code,
        ) ?? {
          unitId: unit.id,
          checklistCode: item.code,
          result: 'NotInspected',
          note: null,
          evidenceIds: [],
        },
    ),
  );
}
export function equipmentInspectionClient(request: SetupRequest) {
  const write = (id: string, action: string, value: unknown, method = 'POST') =>
    request<SetupDocument<EquipmentInspection>>(`/api/v1/equipment-inspections/${id}/${action}`, {
      method,
      body: JSON.stringify(value),
    });
  return {
    forTask: (task: string, signal?: AbortSignal) =>
      request<SetupDocument<EquipmentInspection> | null>(
        `/api/v1/operational-tasks/${task}/equipment-inspection`,
        { signal },
      ),
    list: (asset: string, page = 1) =>
      request<RecordPage<EquipmentInspection>>(`/api/v1/assets/${asset}/inspections?page=${page}`),
    schedules: (asset: string, page = 1) =>
      request<RecordPage<InspectionSchedule>>(
        `/api/v1/assets/${asset}/inspection-schedules?page=${page}`,
      ),
    schedule: (asset: string, id: string, data: InspectionSchedule) =>
      request<SetupDocument<InspectionSchedule>>(
        `/api/v1/assets/${asset}/inspection-schedules/${id}`,
        { method: 'PUT', body: JSON.stringify(data) },
      ),
    generate: (id: string) =>
      request<{ created: number }>(`/api/v1/equipment-inspection-schedules/${id}/generate`, {
        method: 'POST',
      }),
    save: (id: string, expectedVersion: number, answers: InspectionAnswer[], submit: boolean) =>
      write(id, 'answers', { expectedVersion, answers, submit }, 'PUT'),
    review: (id: string, expectedVersion: number, action: 'Verify' | 'Rework', note: string) =>
      write(id, 'review', { expectedVersion, action, note }),
    remediate: (
      id: string,
      expectedVersion: number,
      description: string,
      expectedOutcome: string,
      targetCompletionAt: string,
    ) =>
      write(id, 'remediation', {
        expectedVersion,
        description,
        expectedOutcome,
        targetCompletionAt,
      }),
  };
}
