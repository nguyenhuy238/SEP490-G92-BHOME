export interface Employment {
  id?: string;
  contractNumber: string | null;
  startDate: string;
  endDate: string | null;
  salaryType: string | null;
  baseRate: number | null;
  status: string;
}
export const salaryTypeOptions = [
  { value: 'Monthly', label: 'Theo tháng', unit: 'VND/tháng' },
] as const;
export const salaryTypeLabel = (value: string | null | undefined) =>
  salaryTypeOptions.find((option) => option.value === value)?.label ?? value ?? 'Chưa thiết lập';
export const salaryRateUnit = (value: string | null | undefined) =>
  salaryTypeOptions.find((option) => option.value === value)?.unit ?? 'VND';
export interface Staff {
  userId: string;
  fullName: string;
  phone: string | null;
  email: string;
  isActive: boolean;
  accountVersion: string;
  employment: Employment | null;
}
export interface EmploymentHistoryEntry {
  action: string;
  actorId: string;
  occurredAt: string;
  reason: string | null;
  before: Employment | null;
  after: Employment | null;
}
export interface EmploymentPeriod extends Employment {
  id: string;
  history: EmploymentHistoryEntry[];
}
export interface StaffResponsibilities {
  canDeactivate: boolean;
  assignments: Array<{
    id: string;
    locationId: string;
    locationName: string;
    startDate: string;
    endDate: string;
  }>;
  tasks: Array<{
    id: string;
    locationId: string;
    locationName: string;
    title: string;
    taskType: string;
    status: string;
  }>;
  moveOuts: Array<{
    contractId: string;
    locationId: string;
    locationName: string;
    roomId: string;
    roomNumber: string;
  }>;
}
export interface StaffAssignment {
  id: string;
  staffUserId: string;
  startDate: string;
  endDate: string;
}
export interface StaffAssignmentDetail extends StaffAssignment {
  locationId: string;
  locationName: string;
}
export interface StaffChangePreview {
  locationId: string;
  canRemove: boolean;
  openResponsibilities: Array<{ code: string; count: number }>;
}
export { businessToday as todayVietnam } from '../../../../../packages/client-core/src/contracts';
