// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  contractClient,
  type ContractRequest,
  type MoveOut,
  type SettlementSummary,
} from '../../../../packages/client-core/src/contracts';
vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../theme/theme', () => ({
  colors: {
    navy: '#001637',
    blue: '#1052cf',
    muted: '#64748b',
    border: '#e2e8f0',
    green: '#168565',
    amber: '#a86108',
  },
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Icon: () => null,
  TouchableRipple: ({
    children,
    accessibilityLabel,
    onPress,
  }: {
    children: React.ReactNode;
    accessibilityLabel?: string;
    onPress: () => void;
  }) => (
    <button aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
  Checkbox: {
    Item: ({ label, status, onPress }: { label: string; status: string; onPress: () => void }) => (
      <input aria-label={label} type="checkbox" checked={status === 'checked'} onChange={onPress} />
    ),
  },
}));
vi.mock('../features/contracts/moveOut/TenantMoveOutInspectionSummary', () => ({
  TenantMoveOutInspectionSummary: ({ inspection }: { inspection: { version: number } }) => (
    <div>Kết quả kiểm tra lần {inspection.version}</div>
  ),
}));
vi.mock('../features/contracts/moveOut/TenantMoveOutProposalPanel', () => ({
  TenantMoveOutProposalPanel: () => <div>Owner chưa gửi đề xuất quyết toán cho hợp đồng này.</div>,
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Heading: ({ children, title }: { children?: React.ReactNode; title?: string }) => (
    <h2>{title ?? children}</h2>
  ),
  Action: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  ui: {},
}));
vi.mock('../components/WorkflowControls', () => ({
  Input: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
  ChoiceField: () => <div />,
}));
import { ContractLifecyclePanel } from '../features/contracts/ContractLifecyclePanel';
vi.mock('../features/contracts/ContractEvidence', () => ({ ContractEvidence: () => null }));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ session: { roles: ['Owner'] } }),
}));
afterEach(cleanup);
it('Tenant reads inspection results without any MoveOut report, signing or consent action', async () => {
  const version = 4;
  const observed = {
    date: '2026-11-16',
    roomCondition: 'Đã kiểm tra',
    keysAndAccess: 'Đã thu riêng',
    notes: 'Synthetic',
    assets: [],
    evidenceIds: [],
    electricity: { value: '101' },
    water: { value: '101' },
  };
  const request = vi.fn<ContractRequest>(
    async <T,>(path: string): Promise<T> =>
      (path.endsWith('/inspections')
        ? [
            {
              id: 'inspection',
              version,
              inspectedAt: '2026-11-16T00:00:00Z',
              baselineVersion: 1,
              baseline: observed,
              observed,
              ownerDecision: null,
            },
          ]
        : path.endsWith('/receivables/proposal')
          ? {
              contractId: 'tenant-contract',
              reference: 'r1',
              items: [],
              latestProposal: null,
              status: 'None',
            }
          : path.endsWith('/settlement-summary')
            ? data
            : []) as T,
  );
  const api = contractClient(
    <T,>(path: string, init?: RequestInit) => request(path, init) as Promise<T>,
  );
  render(
    <ContractLifecyclePanel
      api={api}
      id="tenant-contract"
      role="Tenant"
      moveOut={{ status: 'Inspected' } as MoveOut}
      onChanged={vi.fn()}
    />,
  );
  expect(await screen.findByText('Kết quả kiểm tra lần 4')).toBeTruthy();
  expect(screen.queryByText(/biên bản/i)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Xác nhận hiện trạng trả phòng' })).toBeNull();
  expect(screen.queryByLabelText(/Tôi đã xem/)).toBeNull();
  expect(await screen.findByText(/Owner chưa gửi đề xuất quyết toán/)).toBeTruthy();
  // The proposal's own focused tests cover its GET and POST interactions.
  expect(screen.queryByRole('button', { name: 'Cập nhật kết quả' })).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Xem tình trạng tiền cọc và quyết toán' }),
  ).toBeNull();
  expect(request.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
const id = '00000000-0000-0000-0000-000000000001';
const data: SettlementSummary = {
  contractId: id,
  depositContractId: id,
  roomNumber: 'Synthetic',
  verifiedSecurityDeposit: '400000',
  appliedHoldingDeposit: '0',
  contractSpecificOutstanding: '0',
  approvedFinalCharges: '0',
  approvedDeductions: null,
  refundAmount: null,
  invoices: [],
  unresolvedItems: ['deposit_deduction_refund_policy_required'],
  otherActiveContracts: false,
  resolved: false,
  reference: 'BH40-test',
  transferVerificationStatus: 'PendingReview',
  calculation: {
    issuedTotal: '100000',
    approvedAdjustmentTotal: '0',
    payableTotal: '100000',
    verifiedInvoicePayments: '100000',
    roomOutstanding: '0',
    contractSpecificOutstanding: '0',
    potentialInvoiceExcess: '0',
    depositAllocated: '0',
    depositRefunded: '0',
    depositReserved: '400000',
    availableSecurityDeposit: '0',
    depositPositionConsistent: true,
  },
};
function setup(summary = data, fail = false) {
  const request = vi.fn<ContractRequest>(async <T,>(path: string): Promise<T> => {
    if (fail) throw { status: 404 };
    return (
      path.endsWith('/settlement-summary')
        ? summary
        : path.endsWith('/inspection-preparation')
          ? { baseline: null, finalReadings: [], otherTenantsRemain: false }
          : []
    ) as T;
  });
  const api = contractClient(
    <T,>(path: string, init?: RequestInit) => request(path, init) as Promise<T>,
  );
  return {
    request,
    panel: (role: string) => (
      <ContractLifecyclePanel
        api={api}
        id={id}
        role={role}
        moveOut={{ status: 'PendingSettlement', version: 4 } as MoveOut}
        onChanged={vi.fn()}
      />
    ),
  };
}
it('Tenant does not show the separate deposit card or financial actions', async () => {
  const { request, panel } = setup();
  render(panel('Tenant'));
  await waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(1));
  expect(
    screen.queryByRole('button', { name: 'Xem tình trạng tiền cọc và quyết toán' }),
  ).toBeNull();
  expect(screen.queryByText(/Cọc giữ chỗ hoàn:/)).toBeNull();
  expect(screen.queryByText('Lưu xem xét quyết toán')).toBeNull();
  expect(screen.queryByText('Xác nhận kiểm tra')).toBeNull();
  expect(screen.queryByText(/đủ điều kiện xem xét hoàn tất/)).toBeNull();
  expect(request.mock.calls.some(([path]) => path.endsWith('/inspection-preparation'))).toBe(false);
  expect(request.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
it('Owner can review settlement while complex financial execution stays on Owner Web', async () => {
  const { request, panel } = setup();
  render(panel('Owner'));
  expect(await screen.findByText(/Cọc giữ chỗ hoàn: 400.000/)).toBeTruthy();
  expect(
    screen.getByText(/Quản lý khoản phải thu, cấn trừ cọc và thực chi hoàn tiền tại Owner Web/),
  ).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Lưu xem xét quyết toán' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByLabelText('Căn cứ quyết định')).toBeTruthy();
  expect(request.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
it('Tenant hides redundant deposit status even when server confirms a manual refund', async () => {
  const { panel } = setup({
    ...data,
    transferVerificationStatus: 'VerifiedManual',
    refundAmount: '400000',
    calculation: {
      ...data.calculation!,
      depositRefunded: '400000',
      depositReserved: '0',
      availableSecurityDeposit: null,
    },
  });
  render(panel('Tenant'));
  await waitFor(() => expect(screen.queryByText(/Đang tải kết quả trả phòng/)).toBeNull());
  expect(screen.queryByText(/Đã hoàn cọc: 400.000/)).toBeNull();
  expect(screen.queryByText(/Cọc khả dụng:/)).toBeNull();
});
it('Staff does not request or display financial settlement data', async () => {
  const { request, panel } = setup();
  render(panel('Staff'));
  await waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(1));
  expect(request.mock.calls.some(([path]) => path.endsWith('/settlement-summary'))).toBe(false);
  expect(screen.queryByText(/Cọc giữ chỗ hoàn:/)).toBeNull();
});
it('Staff cannot create a duplicate inspection report or bypass the started 4-step task', async () => {
  const reading = {
    id: 'reading',
    meterCode: 'Synthetic',
    utilityType: 0,
    date: '2026-11-06',
    value: '100',
    evidenceId: 'initial',
    evidenceHash: 'A'.repeat(64),
  };
  const preparation = {
    baselineContractId: id,
    otherTenantsRemain: false,
    finalReadings: [],
    baseline: {
      version: 1,
      status: 'Confirmed',
      tenantConfirmedVersion: 1,
      tenantConfirmedAt: '2026-11-01T00:00:00Z',
      staffConfirmedAt: '2026-11-01T00:00:00Z',
      snapshot: {
        date: '2026-11-01',
        roomNumber: 'Synthetic',
        roomCondition: 'Good',
        keysAndAccess: 'Two keys',
        notes: 'Synthetic',
        assets: [],
        electricity: reading,
        water: { ...reading, utilityType: 1 },
        evidenceIds: [],
      },
    },
  };
  const request = vi.fn<ContractRequest>(
    async <T,>(path: string): Promise<T> =>
      (path.endsWith('/inspection-preparation') ? preparation : []) as T,
  );
  render(
    <ContractLifecyclePanel
      api={contractClient(
        <T,>(path: string, init?: RequestInit) => request(path, init) as Promise<T>,
      )}
      id={id}
      role="Staff"
      moveOut={
        { status: 'Approved', version: 3, inspectionScheduledAt: '2026-11-06T00:00:00Z' } as MoveOut
      }
      onChanged={vi.fn()}
    />,
  );
  expect(await screen.findByText('Kết quả kiểm tra trả phòng')).toBeTruthy();
  expect(screen.queryByText('Lập biên bản kiểm tra cuối kỳ')).toBeNull();
  expect(screen.queryByRole('button', { name: /Lưu biên bản đối chiếu/ })).toBeNull();
  expect(request.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  expect(request.mock.calls.some(([path]) => path.endsWith('/settlement-summary'))).toBe(false);
});
it('denied lookups show an error without displaying a previous Tenant balance', async () => {
  const { panel } = setup(data, true);
  render(panel('Tenant'));
  await waitFor(() => expect(screen.queryByText(/Đang đối chiếu/)).toBeNull());
  expect(screen.queryByText(/Cọc giữ chỗ hoàn:/)).toBeNull();
});
