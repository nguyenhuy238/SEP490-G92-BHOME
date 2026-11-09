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
export interface StaffAssignment {
  id: string;
  staffUserId: string;
  startDate: string;
  endDate: string;
}
export const todayVietnam = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
