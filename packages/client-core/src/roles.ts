// Mirrors the API contract. Backend Domain constants remain authoritative.
export const roles = { owner: 'Owner', staff: 'Staff', tenant: 'Tenant' } as const;
export type Role = (typeof roles)[keyof typeof roles];
export const roleLabels: Record<Role, string> = {
  [roles.owner]: 'Chủ nhà',
  [roles.staff]: 'Nhân viên',
  [roles.tenant]: 'Người thuê',
};
