import { describe, expect, it } from 'vitest';
import {
  canOpenScreen,
  homeScreen,
  isWorkspaceScreen,
  sessionRole,
  type MobileRole,
} from '../../../src/mobile/src/features/workspace/navigation';
import {
  invoiceLines,
  previewWorkspaceService,
} from '../../../src/mobile/src/services/workspaceData';

describe('mobile workspace access boundaries', () => {
  it('rejects unknown roles and invalid deep links', () => {
    expect(sessionRole(['Guest', 'Administrator'])).toBeNull();
    expect(isWorkspaceScreen('toString')).toBe(false);
    expect(isWorkspaceScreen('../../approvals')).toBe(false);
    expect(isWorkspaceScreen('unknown')).toBe(false);
  });
  it.each(['Staff', 'Tenant'] as const)(
    'does not allow %s to enter Owner approvals or operations',
    (role) => {
      expect(canOpenScreen(role, 'approvals')).toBe(false);
      expect(canOpenScreen(role, 'operations')).toBe(false);
    },
  );
  it('does not allow Owner or Tenant into Staff meter collection', () => {
    expect(canOpenScreen('Tenant', 'meter-reading')).toBe(false);
    expect(canOpenScreen('Owner', 'meter-reading')).toBe(false);
    expect(canOpenScreen('Staff', 'meter-reading')).toBe(true);
  });
  it('does not show another role the private Tenant document screens', () => {
    for (const screen of ['contract', 'checklist', 'invoice', 'incidents'] as const) {
      expect(canOpenScreen('Staff', screen)).toBe(false);
      expect(canOpenScreen('Owner', screen)).toBe(false);
      expect(canOpenScreen('Tenant', screen)).toBe(true);
    }
  });
  it.each(['Owner', 'Staff', 'Tenant'] as MobileRole[])(
    'opens the correct home and shared settings for %s',
    (role) => {
      expect(canOpenScreen(role, homeScreen[role])).toBe(true);
      expect(canOpenScreen(role, 'profile')).toBe(true);
      expect(canOpenScreen(role, 'preferences')).toBe(true);
    },
  );
  it('uses server roles with deterministic precedence for multi-role sessions', () => {
    expect(sessionRole(['Tenant', 'Staff'])).toBe('Staff');
    expect(sessionRole(['Tenant', 'Staff', 'Owner'])).toBe('Owner');
  });
});
describe('isolated synthetic data', () => {
  it('does not expose Owner finance or another room notification to Staff/Tenant previews', async () => {
    const tenant = await previewWorkspaceService.load('Tenant');
    const staff = await previewWorkspaceService.load('Staff');
    expect(tenant.approvals).toEqual([]);
    expect(tenant.workOrders).toEqual([]);
    expect(tenant.notices.some((item) => item.title.includes('P.205'))).toBe(false);
    expect(staff.approvals).toEqual([]);
    expect(staff.notices.some((item) => item.category === 'Tài chính')).toBe(false);
  });
  it('reconciles invoice line amounts with the displayed total', () => {
    expect(invoiceLines.reduce((sum, item) => sum + item.amount, 0)).toBe(5420000);
  });
});
