import { expect, it } from 'vitest';
import { canOpenScreen, activeWorkspaceTab } from '../features/workspace/navigation';
import { staffFeatureGroups } from '../features/workspace/staffFeatures';
it.each(['Owner', 'Tenant'] as const)('blocks %s from Staff-only incident routes', (role) => {
  for (const route of ['report-incident', 'staff-maintenance', 'staff-emergencies'] as const)
    expect(canOpenScreen(role, route)).toBe(false);
});
it('allows Tenant report detail but not maintenance finance screens', () => {
  expect(canOpenScreen('Tenant', 'incident-detail')).toBe(true);
  expect(canOpenScreen('Tenant', 'maintenance-detail')).toBe(false);
  expect(canOpenScreen('Tenant', 'owner-incidents')).toBe(false);
  expect(activeWorkspaceTab('Tenant', 'incident-detail')).toBe('tenant-requests');
});
it('keeps maintenance distinct from operational tasks and preserves Staff navigation', () => {
  const group = staffFeatureGroups.find((item) => item.title === 'SỰ CỐ & BẢO TRÌ')!;
  expect(group.items.map((item) => item.screen)).toEqual([
    'report-incident',
    'staff-maintenance',
    'staff-emergencies',
  ]);
  expect(activeWorkspaceTab('Staff', 'maintenance-detail')).toBe('work-orders');
  expect(activeWorkspaceTab('Owner', 'owner-maintenance')).toBe('operations');
});
