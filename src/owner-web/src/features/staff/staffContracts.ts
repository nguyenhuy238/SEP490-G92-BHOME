export interface Employment {
  id?: string;
  contractNumber: string | null;
  employmentType: string;
  startDate: string;
  endDate: string | null;
  salaryType: string | null;
  baseRate: number | null;
  status: string;
}
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
export const todayVietnam = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
