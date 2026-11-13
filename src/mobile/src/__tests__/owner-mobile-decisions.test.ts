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

it('enables existing Owner contract decisions while keeping Staff approvals unavailable', () => {
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
  expect(
    mobileContractActions(holding('Draft'), null, 'Owner', id).map((item) => item.operation),
  ).toContain('holding-approval');
  expect(
    mobileContractActions(holding('PendingActivation'), null, 'Owner', id).map(
      (item) => item.operation,
    ),
  ).toContain('holding-activation');
  expect(
    mobileContractActions(holding('Active'), null, 'Owner', id).map((item) => item.operation),
  ).toContain('holding-conversion');
  for (const status of ['Draft', 'PendingSigning', 'PendingActivation']) {
    expect(
      mobileContractActions({ ...holding(status), kind: 'Main' }, null, 'Owner', id).map(
        (item) => item.operation,
      ),
    ).toContain('activate');
  }
  expect(
    mobileContractActions({ ...holding('Cancelled'), kind: 'Main' }, null, 'Owner', id),
  ).toEqual([]);
  expect(
    mobileContractActions({ ...holding('Active'), kind: 'Main' }, null, 'Owner', id).map(
      (item) => item.operation,
    ),
  ).toContain('renewals');
  for (const status of ['Draft', 'PendingSigning', 'PendingActivation', 'Active', 'Cancelled']) {
    expect(
      mobileContractActions(holding(status), null, 'Staff', id).some((item) =>
        ['holding-approval', 'holding-activation', 'deposit-verifications'].includes(
          item.operation,
        ),
      ),
    ).toBe(false);
  }
});

it('routes an Owner adjustment notification to the real review screen', async () => {
  const api = {
    request: vi.fn().mockResolvedValue({ objectType: 'Adjustment', objectId: id }),
  };
  await expect(
    notificationDestination(api as never, 'Owner', id, new AbortController().signal),
  ).resolves.toEqual({ screen: 'owner-adjustment-detail', params: { adjustmentId: id } });
});
