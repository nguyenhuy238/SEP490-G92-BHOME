export type MobileRole = 'Owner' | 'Staff' | 'Tenant';
export const screenRoles = {
  'incident-detail': ['Owner', 'Staff', 'Tenant'],
  'maintenance-detail': ['Owner', 'Staff'],
  'staff-incidents': ['Staff'],
  'owner-incidents': ['Owner'],
  'owner-maintenance': ['Owner'],
  'owner-emergencies': ['Owner'],
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
  'task-detail': ['Owner', 'Staff'],
  'owner-home': ['Owner'],
  approvals: ['Owner'],
  operations: ['Owner'],
  'staff-home': ['Staff'],
  'work-orders': ['Staff'],
  'meter-reading': ['Staff'],
  'tenant-home': ['Tenant'],
  'tenant-room': ['Tenant'],
  'tenant-requests': ['Tenant'],
  'tenant-meters': ['Tenant'],
  invoice: ['Tenant'],
  incidents: ['Tenant'],
  contract: ['Tenant'],
  checklist: ['Tenant'],
  profile: ['Owner', 'Staff', 'Tenant'],
  notifications: ['Owner', 'Staff', 'Tenant'],
  'send-notification': ['Staff'],
  'staff-assets': ['Staff'],
  'staff-maintenance': ['Staff'],
  'staff-emergencies': ['Staff'],
  'staff-invoices': ['Staff'],
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
      { screen: 'staff-home', title: 'Trang chủ', icon: 'home-outline' },
      { screen: 'work-orders', title: 'Công việc', icon: 'clipboard-check-outline' },
      { screen: 'notifications', title: 'Thông báo', icon: 'bell-outline' },
      { screen: 'profile', title: 'Cá nhân', icon: 'account' },
    ],
    Tenant: [
      { screen: 'tenant-home', title: 'Trang chủ', icon: 'home-outline' },
      { screen: 'invoice', title: 'Hóa đơn', icon: 'receipt-text-outline' },
      { screen: 'tenant-requests', title: 'Yêu cầu', icon: 'clipboard-text-outline' },
      { screen: 'profile', title: 'Cá nhân', icon: 'account-outline' },
    ],
  };

export function activeWorkspaceTab(role: MobileRole, screen: WorkspaceScreen): WorkspaceScreen {
  if (role === 'Tenant') {
    if (['profile', 'security', 'preferences'].includes(screen)) return 'profile';
    if (['invoice', 'billing-history', 'adjustment', 'tenant-meters'].includes(screen))
      return 'invoice';
    if (['incidents', 'tenant-requests', 'incident-detail'].includes(screen))
      return 'tenant-requests';
    return 'tenant-home';
  }
  if (role === 'Staff') {
    if (['profile', 'security', 'preferences'].includes(screen)) return 'profile';
    if (
      [
        'work-orders',
        'task-detail',
        'shifts',
        'report-incident',
        'staff-maintenance',
        'staff-emergencies',
        'staff-incidents',
        'incident-detail',
        'maintenance-detail',
      ].includes(screen)
    )
      return 'work-orders';
    if (['notifications', 'send-notification'].includes(screen)) return 'notifications';
    return 'staff-home';
  }
  if (
    role === 'Owner' &&
    [
      'owner-incidents',
      'owner-maintenance',
      'owner-emergencies',
      'incident-detail',
      'maintenance-detail',
    ].includes(screen)
  )
    return 'operations';
  if (['contract', 'checklist', 'residence', 'contract-request'].includes(screen))
    return 'tenant-home';
  if (['security', 'preferences'].includes(screen)) return 'profile';
  if (screen === 'task-detail') return role === 'Owner' ? 'operations' : 'work-orders';
  if (['adjustment', 'billing-history'].includes(screen)) return 'invoice';
  return screen;
}
