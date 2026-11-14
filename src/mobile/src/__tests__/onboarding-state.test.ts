import { expect, it } from 'vitest';
import { activeWorkspaceTab, canOpenScreen, tabs } from '../features/workspace/navigation';
import {
  allIdentitiesConfirmed,
  peopleReady,
  residentType,
  type OnboardingPerson,
} from '../features/onboarding/onboarding';
const person: OnboardingPerson = {
  key: 'p1',
  label: 'Hồ sơ mẫu',
  email: 'occupant@example.invalid',
  status: 'unscanned',
};
it('requires a representative, nonempty labels and explicit confirmation for every created resident', () => {
  expect(peopleReady([person], 'unknown')).toBe(false);
  expect(peopleReady([{ ...person, label: ' ' }], 'p1')).toBe(false);
  expect(peopleReady([person], 'p1')).toBe(true);
  expect(peopleReady([{ ...person, email: '' }], 'p1')).toBe(false);
  expect(peopleReady([{ ...person, email: 'invalid' }], 'p1')).toBe(false);
  expect(
    peopleReady([person, { ...person, key: 'p2', email: 'OCCUPANT@example.invalid' }], 'p1'),
  ).toBe(false);
  expect(allIdentitiesConfirmed([])).toBe(false);
  expect(allIdentitiesConfirmed([{ ...person, status: 'confirmed' }])).toBe(false);
  expect(allIdentitiesConfirmed([{ ...person, residentId: 'r1', status: 'pending' }])).toBe(false);
  expect(allIdentitiesConfirmed([{ ...person, residentId: 'r1', status: 'confirmed' }])).toBe(true);
});
it('preserves the existing resident type contract for households and separate tenants', () => {
  expect(residentType('family', 'p1', 'p1')).toBe(0);
  expect(residentType('family', 'p2', 'p1')).toBe(1);
  expect(residentType('individual', 'p2', 'p1')).toBe(0);
});
it('offers four authorized Staff tabs and maps nested screens to the correct tab', () => {
  expect(tabs.Staff.map((tab) => tab.screen)).toEqual([
    'staff-home',
    'work-orders',
    'notifications',
    'profile',
  ]);
  for (const tab of tabs.Staff) expect(canOpenScreen('Staff', tab.screen)).toBe(true);
  expect(activeWorkspaceTab('Staff', 'onboarding')).toBe('staff-home');
  expect(activeWorkspaceTab('Staff', 'task-detail')).toBe('work-orders');
  expect(activeWorkspaceTab('Staff', 'send-notification')).toBe('notifications');
  expect(activeWorkspaceTab('Staff', 'security')).toBe('profile');
  expect(activeWorkspaceTab('Owner', 'task-detail')).toBe('operations');
  expect(activeWorkspaceTab('Tenant', 'contract')).toBe('tenant-home');
  expect(tabs.Owner).toHaveLength(4);
  expect(tabs.Tenant).toHaveLength(4);
});
it('keeps Tenant feature routes isolated and selects the matching bottom tab', () => {
  for (const route of ['tenant-room', 'tenant-meters', 'tenant-requests'] as const) {
    expect(canOpenScreen('Tenant', route)).toBe(true);
    expect(canOpenScreen('Staff', route)).toBe(false);
    expect(canOpenScreen('Owner', route)).toBe(false);
  }
  expect(activeWorkspaceTab('Tenant', 'incidents')).toBe('tenant-requests');
  expect(activeWorkspaceTab('Tenant', 'tenant-meters')).toBe('invoice');
  expect(activeWorkspaceTab('Tenant', 'checklist')).toBe('tenant-home');
  expect(activeWorkspaceTab('Tenant', 'security')).toBe('profile');
});
