export type MobileRole = 'Owner' | 'Staff' | 'Tenant';
export const screenRoles = {
  onboarding: ['Staff'],
  'prepare-contract': ['Staff'],
  'move-out': ['Staff'],
  'report-incident': ['Staff'],
  'move-in': ['Staff'],
  residence: ['Tenant'],
  adjustment: ['Tenant'],
  'contract-request': ['Tenant'],
  signing: ['Owner', 'Staff', 'Tenant'],
  'billing-history': ['Tenant'],
  shifts: ['Staff'],
  rooms: ['Staff'],
  'debt-follow-up': ['Staff'],
  'task-detail': ['Staff'],
  'owner-home': ['Owner'],
  approvals: ['Owner'],
  operations: ['Owner'],
  'staff-home': ['Staff'],
  'work-orders': ['Staff'],
  'meter-reading': ['Staff'],
  'tenant-home': ['Tenant'],
  invoice: ['Tenant'],
  incidents: ['Tenant'],
  contract: ['Tenant'],
  checklist: ['Tenant'],
  profile: ['Owner', 'Staff', 'Tenant'],
  notifications: ['Owner', 'Staff', 'Tenant'],
  security: ['Owner', 'Staff', 'Tenant'],
  preferences: ['Owner', 'Staff', 'Tenant'],
} satisfies Record<string, MobileRole[]>;
export type WorkspaceScreen = keyof typeof screenRoles;
export function isWorkspaceScreen(value: string): value is WorkspaceScreen {
  return Object.hasOwn(screenRoles, value);
}
export function canOpenScreen(role: MobileRole, screen: WorkspaceScreen) {
  return (screenRoles[screen] as readonly MobileRole[]).includes(role);
}
export function sessionRole(roles: readonly string[]): MobileRole | null {
  return roles.includes('Owner')
    ? 'Owner'
    : roles.includes('Staff')
      ? 'Staff'
      : roles.includes('Tenant')
        ? 'Tenant'
        : null;
}
export const homeScreen: Record<MobileRole, WorkspaceScreen> = {
  Owner: 'owner-home',
  Staff: 'staff-home',
  Tenant: 'tenant-home',
};
export const roleLabel: Record<MobileRole, string> = {
  Owner: 'Chủ cơ sở',
  Staff: 'Nhân viên',
  Tenant: 'Khách thuê',
};
export const tabs: Record<MobileRole, { screen: WorkspaceScreen; title: string; icon: string }[]> =
  {
    Owner: [
      { screen: 'owner-home', title: 'Tổng quan', icon: 'view-dashboard-outline' },
      { screen: 'approvals', title: 'Phê duyệt', icon: 'clipboard-check-outline' },
      { screen: 'operations', title: 'Vận hành', icon: 'tune-variant' },
      { screen: 'profile', title: 'Tài khoản', icon: 'account-cog-outline' },
    ],
    Staff: [
      { screen: 'staff-home', title: 'Ca trực', icon: 'clipboard-check-outline' },
      { screen: 'work-orders', title: 'Công việc', icon: 'calendar-month-outline' },
      { screen: 'meter-reading', title: 'Điện nước', icon: 'meter-electric-outline' },
      { screen: 'profile', title: 'Tài khoản', icon: 'badge-account-outline' },
    ],
    Tenant: [
      { screen: 'tenant-home', title: 'Trang chủ', icon: 'home-outline' },
      { screen: 'invoice', title: 'Hóa đơn', icon: 'receipt-text-outline' },
      { screen: 'incidents', title: 'Báo sự cố', icon: 'wrench-outline' },
      { screen: 'profile', title: 'Tài khoản', icon: 'account-outline' },
    ],
  };
