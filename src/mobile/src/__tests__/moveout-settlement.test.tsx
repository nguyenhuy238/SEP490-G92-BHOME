// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  contractClient,
  type ContractRequest,
  type MoveOut,
  type SettlementSummary,
} from '../../../../packages/client-core/src/contracts';
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Checkbox: {
    Item: ({ label, status, onPress }: { label: string; status: string; onPress: () => void }) => (
      <input aria-label={label} type="checkbox" checked={status === 'checked'} onChange={onPress} />
    ),
  },
}));
vi.mock('../components/WorkspaceKit', () => ({
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Heading: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
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
afterEach(cleanup);
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
        evidenceIds={[]}
        onChanged={vi.fn()}
      />
    ),
  };
}
it('Tenant reads server deposit reservation without Owner refund/approval actions or a false completion', async () => {
  const { request, panel } = setup();
  render(panel('Tenant'));
  expect(await screen.findByText(/Cọc giữ chỗ hoàn: 400.000/)).toBeTruthy();
  expect(screen.getByText(/Cọc đang được đối chiếu hoặc chờ giao dịch hoàn/)).toBeTruthy();
  expect(screen.queryByText('Lưu xem xét quyết toán')).toBeNull();
  expect(screen.queryByText('Xác nhận kiểm tra')).toBeNull();
  expect(screen.queryByText(/đủ điều kiện xem xét hoàn tất/)).toBeNull();
  expect(request.mock.calls.some(([path]) => path.endsWith('/inspection-preparation'))).toBe(false);
  expect(request.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
it('Owner monitors the settlement summary and performs financial decisions through Owner Web', async () => {
  const { request, panel } = setup();
  render(panel('Owner'));
  expect(await screen.findByText(/Cọc giữ chỗ hoàn: 400.000/)).toBeTruthy();
  expect(
    screen.getByText(
      /Xác nhận biên bản, duyệt khoản phải thu, cấn trừ và quyết toán tại Owner Web/,
    ),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Lưu xem xét quyết toán' })).toBeNull();
  expect(screen.queryByLabelText('Căn cứ quyết định')).toBeNull();
  expect(request.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
it('shows verified manual return only from the server and retains unknown amounts as unknown', async () => {
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
  expect(await screen.findByText(/Đã hoàn cọc: 400.000/)).toBeTruthy();
  expect(screen.getByText(/Cọc khả dụng: Chờ xác minh/)).toBeTruthy();
  expect(screen.getByText(/Hoàn cọc đã được Owner xác minh thủ công/)).toBeTruthy();
});
it('Staff does not request or display financial settlement data', async () => {
  const { request, panel } = setup();
  render(panel('Staff'));
  await waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(1));
  expect(request.mock.calls.some(([path]) => path.endsWith('/settlement-summary'))).toBe(false);
  expect(screen.queryByText(/Cọc giữ chỗ hoàn:/)).toBeNull();
});
it('Staff inspection consent remains separate from Owner settlement and resets when observed data changes', async () => {
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
      evidenceIds={['new-evidence']}
      onChanged={vi.fn()}
    />,
  );
  const confirmation = await screen.findByLabelText(
    'Tôi xác nhận hiện trạng và chỉ số đã đối chiếu thực tế',
  );
  fireEvent.click(screen.getByLabelText('Ảnh hiện trạng 1'));
  fireEvent.click(confirmation);
  expect(
    (screen.getByRole('button', { name: 'Lưu biên bản đối chiếu' }) as HTMLButtonElement).disabled,
  ).toBe(false);
  fireEvent.change(screen.getByLabelText('Hiện trạng phòng khi trả'), {
    target: { value: 'Changed condition' },
  });
  expect((confirmation as HTMLInputElement).checked).toBe(false);
  expect(
    (screen.getByRole('button', { name: 'Lưu biên bản đối chiếu' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(request.mock.calls.some(([path]) => path.endsWith('/settlement-summary'))).toBe(false);
});
it('denied lookups show an error without displaying a previous Tenant balance', async () => {
  const { panel } = setup(data, true);
  render(panel('Tenant'));
  await waitFor(() => expect(screen.queryByText(/Đang đối chiếu/)).toBeNull());
  expect(screen.queryByText(/Cọc giữ chỗ hoàn:/)).toBeNull();
});
