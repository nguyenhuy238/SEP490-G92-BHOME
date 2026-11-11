import { expect, it, vi } from 'vitest';
import { contractActions, type ContractView } from '../../../../packages/client-core/src/contracts';
import { canOpenScreen } from '../features/workspace/navigation';
import { notificationDestination } from '../services/notificationInbox';
import { mobileContractActions } from '../features/contracts/contractSections';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function holding(status: string): ContractView {
  return {
    id,
    roomId: id,
    locationId: id,
    kind: 'Holding',
    status,
    startDate: '2026-11-10',
    endDate: '2027-11-10',
    monthlyRent: '3000000',
    requiredDeposit: '1000000',
    terms: 'Điều khoản giữ chỗ',
    previousContractId: null,
    residentIds: [id],
    signatures: [],
    activatedAt: null,
    ownerSignerId: id,
    tenantUserId: id,
    representativeResidentId: id,
    holdingContractId: null,
    appliedHoldingDeposit: '0',
    holdingExpiresAt: '2027-11-10T00:00:00Z',
    approvedAt: status === 'Draft' ? null : '2026-11-09T00:00:00Z',
    convertedMainContractId: null,
  };
}

it('exposes Owner-only decision screens without opening them to Tenant', () => {
  for (const screen of [
    'owner-adjustments',
    'owner-adjustment-detail',
    'owner-payments',
    'owner-payment-detail',
    'owner-announcements',
    'owner-finance',
  ] as const) {
    expect(canOpenScreen('Owner', screen)).toBe(true);
    expect(canOpenScreen('Tenant', screen)).toBe(false);
  }
});

it('preserves Owner Web Holding decisions while Mobile has no Owner mutation actions', () => {
  expect(contractActions(holding('Draft'), null, 'Owner', id).map((x) => x.operation)).toContain(
    'holding-approval',
  );
  const pending = contractActions(holding('PendingActivation'), null, 'Owner', id).map(
    (x) => x.operation,
  );
  expect(pending).toContain('holding-activation');
  expect(pending).not.toContain('activate');
  const active = contractActions(holding('Active'), null, 'Owner', id).map((x) => x.operation);
  expect(active).toContain('holding-conversion');
  expect(active).not.toContain('renewals');
  expect(active).not.toContain('expiry-move-out');
  for (const status of ['Draft', 'PendingSigning', 'PendingActivation', 'Active', 'Cancelled'])
    expect(mobileContractActions(holding(status), null, 'Owner', id)).toEqual([]);
});

it('routes an Owner adjustment notification to the real review screen', async () => {
  const api = {
    request: vi.fn().mockResolvedValue({ objectType: 'Adjustment', objectId: id }),
  };
  await expect(
    notificationDestination(api as never, 'Owner', id, new AbortController().signal),
  ).resolves.toEqual({ screen: 'owner-adjustment-detail', params: { adjustmentId: id } });
});
