// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ContractView, Readiness } from '../../../../packages/client-core/src/contracts';
const state = vi.hoisted(() => ({
  mode: 'MYSIGN',
  accepted: false,
  request: vi.fn(),
  changed: vi.fn(),
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ session: { roles: ['Owner'] } }),
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: () => ({
    data: state.accepted
      ? { tenantAcceptedAt: '2026-11-13T00:00:00Z', ownerAcceptedAt: null }
      : null,
    error: '',
  }),
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Heading: ({ title, detail }: { title: string; detail?: string }) => (
    <h2>
      {title} {detail}
    </h2>
  ),
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
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
}));
vi.mock('../features/contracts/RentalContractStepper', () => ({
  RentalContractStepper: ({ completed }: { completed: string[] }) => (
    <output>{JSON.stringify(completed)}</output>
  ),
}));
vi.mock('../features/contracts/ContractActionForm', () => ({
  ContractActionForm: ({
    action,
    onSuccess,
  }: {
    action: { operation: string };
    onSuccess: () => void;
  }) => <button onClick={onSuccess}>Thực hiện {action.operation}</button>,
}));
vi.mock('../features/contracts/ContractWorkflowPanel', () => ({
  ContractWorkflowPanel: () => <span>PDF từ máy chủ</span>,
}));
vi.mock('../features/owner/OwnerHoldingSigning', () => ({
  OwnerHoldingSigning: () => <span>Chấp thuận nội bộ</span>,
}));
import { OwnerMainContractFlow } from '../features/owner/OwnerMainContractFlow';
const c = {
  id: 'contract',
  startDate: '2026-11-13',
  endDate: '2027-11-13',
  monthlyRent: '3000000',
  status: 'PendingSigning',
  kind: 'Main',
  signatures: [],
  ownerSignerId: 'owner',
  tenantUserId: 'tenant',
  requiredDeposit: '1000000',
  appliedHoldingDeposit: '0',
  signingMode: 'MYSIGN',
} as unknown as ContractView;
const readiness = (ready: boolean): Readiness => ({
  ready,
  verifiedDeposit: ready ? '1000000' : '0',
  remainingDeposit: ready ? '0' : '1000000',
  blockers: ready ? [] : ['verified_signature_evidence_required', 'verified_deposit_required'],
});
const mount = (contract = c, r = readiness(false)) =>
  render(
    <OwnerMainContractFlow
      api={{ transport: state.request } as never}
      contract={contract}
      readiness={r}
      actorId="owner"
      onChanged={state.changed}
    />,
  );
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.accepted = false;
});
it('separates requesting MySign from a verified signature and refreshes after the action', () => {
  mount();
  expect(screen.getByText(/Chữ ký số MySign/)).toBeTruthy();
  expect(screen.queryByText('Chấp thuận nội bộ')).toBeNull();
  fireEvent.click(screen.getByText('Yêu cầu ký MySign'));
  fireEvent.click(screen.getByText('Thực hiện signing'));
  expect(state.changed).toHaveBeenCalledOnce();
  expect(screen.getByText('Owner: Chờ xác nhận ký')).toBeTruthy();
});
it('does not complete a step just by visiting it or enable activation with missing signatures/deposit', () => {
  mount();
  fireEvent.click(screen.getByText('Xem tiền cọc'));
  fireEvent.click(screen.getByText('Kiểm tra kích hoạt'));
  expect((screen.getByText('Kích hoạt hợp đồng') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('status').textContent).not.toContain('sign');
  expect(screen.getByRole('status').textContent).not.toContain('payment');
});
it('uses explicit internal signing mode, shows each party separately and still respects readiness', () => {
  state.accepted = true;
  mount({ ...c, signingMode: 'INTERNAL_OTP_DRAWN' });
  expect(screen.getByText('Chấp thuận nội bộ')).toBeTruthy();
  expect(screen.queryByText('Yêu cầu ký MySign')).toBeNull();
  expect(screen.getByText('Người đại diện: Đã xác minh')).toBeTruthy();
  expect(screen.getByText('Owner: Chờ xác nhận ký')).toBeTruthy();
  fireEvent.click(screen.getByText('Xem tiền cọc'));
  fireEvent.click(screen.getByText('Kiểm tra kích hoạt'));
  expect((screen.getByText('Kích hoạt hợp đồng') as HTMLButtonElement).disabled).toBe(true);
});
it('enables activation only from server readiness and does not synthesize a QR', () => {
  const contract = {
    ...c,
    status: 'PendingActivation',
    signatures: [
      { signerUserId: 'owner', status: 'Signed' },
      { signerUserId: 'tenant', status: 'Signed' },
    ],
  } as ContractView;
  mount(contract, readiness(true));
  expect((screen.getByText('Kích hoạt hợp đồng') as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByText('Bước trước'));
  expect(screen.getByText(/API hiện tại chưa cấp QR nộp cọc hợp đồng/)).toBeTruthy();
  expect(screen.queryByRole('img')).toBeNull();
});
it('keeps activation blocked even when local signature/deposit indicators are complete but backend says no', () => {
  const contract = {
    ...c,
    status: 'PendingActivation',
    signatures: [
      { signerUserId: 'owner', status: 'Signed' },
      { signerUserId: 'tenant', status: 'Signed' },
    ],
  } as ContractView;
  const r = { ...readiness(true), ready: false, blockers: ['room_contract_conflict'] };
  mount(contract, r);
  expect((screen.getByText('Kích hoạt hợp đồng') as HTMLButtonElement).disabled).toBe(true);
});
