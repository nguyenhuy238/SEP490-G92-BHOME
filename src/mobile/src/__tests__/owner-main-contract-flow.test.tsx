// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ContractView, Readiness } from '../../../../packages/client-core/src/contracts';
const state = vi.hoisted(() => ({
  mode: 'MYSIGN',
  accepted: false,
  error: '',
  request: vi.fn(),
  changed: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ session: { roles: ['Owner'] } }),
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: () => ({
    data: state.accepted
      ? { tenantAcceptedAt: '2026-11-13T00:00:00Z', ownerAcceptedAt: null }
      : null,
    error: state.error,
    reload: state.refresh,
  }),
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('../components/WorkspaceKit', async () => {
  const { default: View } = await vi.importActual<{
    default: React.ComponentType<{ children: React.ReactNode }>;
  }>('react-native-web/dist/cjs/exports/View');
  return {
    ui: {},
    Box: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
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
  };
});
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
  SigningCertificates: () => <span>Chứng thư của Owner hiện tại</span>,
}));
vi.mock('../features/contracts/ContractWorkflowPanel', () => ({
  ContractWorkflowPanel: () => <span>PDF từ máy chủ</span>,
}));
vi.mock('../features/owner/OwnerHoldingSigning', () => ({
  OwnerHoldingSigning: ({ onChanged }: { onChanged: () => void }) => (
    <>
      <span>Chấp thuận nội bộ</span>
      <button onClick={onChanged}>Refresh internal evidence</button>
    </>
  ),
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
  vi.restoreAllMocks();
  state.accepted = false;
  state.error = '';
});
it.each(['INTERNAL_OTP_DRAWN', 'MYSIGN'])(
  'renders pending signing without raw text inside a native View (%s)',
  (signingMode) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    mount({ ...c, signingMode });
    expect(errors).not.toHaveBeenCalled();
  },
);
it('renders an internal signing API error inside Text', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  state.error = 'Signing status unavailable';
  mount({ ...c, signingMode: 'INTERNAL_OTP_DRAWN' });
  expect(screen.getByText(state.error)).toBeTruthy();
  expect(errors).not.toHaveBeenCalled();
});
it('separates requesting MySign from a verified signature and refreshes after the action', () => {
  mount();
  expect(screen.getByText(/Chữ ký số MySign/)).toBeTruthy();
  expect(screen.queryByText('Chấp thuận nội bộ')).toBeNull();
  expect(screen.getByText('Chứng thư của Owner hiện tại')).toBeTruthy();
  fireEvent.click(screen.getByText('Yêu cầu ký MySign'));
  fireEvent.click(screen.getByText('Thực hiện signing'));
  expect(state.changed).toHaveBeenCalledOnce();
  expect(screen.getByText('Owner: Chờ xác nhận ký')).toBeTruthy();
});
it('refreshes parent evidence after internal actions and does not fall back from an unknown signing mode', () => {
  const view = mount({ ...c, signingMode: 'INTERNAL_OTP_DRAWN' });
  fireEvent.click(screen.getByText('Refresh internal evidence'));
  expect(state.refresh).toHaveBeenCalledOnce();
  expect(state.changed).toHaveBeenCalledOnce();
  view.unmount();
  mount({ ...c, signingMode: 'UNSUPPORTED_PROVIDER' });
  expect(screen.getByText(/Phương thức ký chưa được hỗ trợ/)).toBeTruthy();
  expect(screen.queryByText('Yêu cầu ký MySign')).toBeNull();
  expect(screen.queryByText('Chấp thuận nội bộ')).toBeNull();
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
