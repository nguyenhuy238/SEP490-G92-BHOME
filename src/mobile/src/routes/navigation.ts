import { roles } from '@bhome/client-core/roles.ts';
export const mobileNavigation = [
  { role: roles.owner, path: '/owner' },
  { role: roles.staff, path: '/staff' },
  { role: roles.tenant, path: '/tenant' },
] as const;
