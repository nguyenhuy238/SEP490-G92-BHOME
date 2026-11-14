import { expect, it } from 'vitest';
import {
  activeWorkspaceTab,
  canOpenScreen,
  ownerWebOnlyScreens,
  tabs,
} from '../features/workspace/navigation';

it('offers four Owner monitoring tabs and preserves Staff/Tenant tabs', () => {
  expect(tabs.Owner.map(({ title }) => title)).toEqual([
    'Tổng quan',
    'Cần xử lý',
    'Vận hành',
    'Tài khoản',
  ]);
  expect(tabs.Staff.map(({ screen }) => screen)).toEqual([
    'staff-home',
    'work-orders',
    'notifications',
    'profile',
  ]);
  expect(tabs.Tenant.map(({ screen }) => screen)).toEqual([
    'tenant-home',
    'invoice',
    'tenant-requests',
    'profile',
  ]);
});

it('keeps legacy finance links informational and isolates Owner decisions', () => {
  for (const screen of [
    'owner-payments',
    'owner-payment-detail',
    'owner-adjustments',
    'owner-adjustment-detail',
  ] as const) {
    expect(ownerWebOnlyScreens[screen]).toBeTruthy();
    expect(canOpenScreen('Staff', screen)).toBe(false);
    expect(canOpenScreen('Tenant', screen)).toBe(false);
  }
  expect(activeWorkspaceTab('Owner', 'task-detail')).toBe('operations');
  expect(activeWorkspaceTab('Owner', 'security')).toBe('profile');
});
