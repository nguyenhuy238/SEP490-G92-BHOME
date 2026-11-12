export interface OwnerTask {
  id: string;
  locationId: string;
  kind: string;
  title: string;
  requirements: string;
  priority: string;
  dueAt: string | null;
  evidenceRequired: boolean;
  status: string;
  isOverdue: boolean;
  currentResponsibleStaffUserId: string | null;
  recordedStaffUserId: string | null;
  responsibilityAvailable: boolean;
  result: string | null;
  version: number;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
}
export interface TaskWork {
  title: string;
  requirements: string;
  priority: string;
  dueAt: string;
  evidenceRequired: boolean;
}
export interface TaskHistory {
  id: string;
  action: string;
  note: string;
  occurredAt: string;
  taskVersion: number;
  actorId: string;
  responsibleStaffUserId: string | null;
}
export interface TaskActor {
  userId: string;
  displayName: string;
}
export interface TaskEvidence {
  id: string;
  contentType: string;
  length: number;
  createdAt: string;
  submissionId: string | null;
}
export interface RecurringTemplate extends Omit<TaskWork, 'dueAt'> {
  id: string;
  locationId: string;
  intervalDays: number;
  nextRunAt: string;
  dueAfterHours: number;
  isActive: boolean;
  version: number;
  scheduleType?: 'IntervalDays' | 'Daily' | 'Weekly' | 'Monthly';
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
}
export const taskStatus: Record<string, string> = {
  Assigned: 'Đã giao',
  InProgress: 'Đang thực hiện',
  PendingVerification: 'Chờ nghiệm thu',
  Completed: 'Đã hoàn thành',
  Cancelled: 'Đã hủy',
};
export const vietnamDateInput = (iso: string) =>
  iso
    ? new Date(iso)
        .toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
        .replace(' ', 'T')
        .slice(0, 16)
    : '';
export const vietnamInstant = (input: string) => new Date(input + ':00+07:00').toISOString();
