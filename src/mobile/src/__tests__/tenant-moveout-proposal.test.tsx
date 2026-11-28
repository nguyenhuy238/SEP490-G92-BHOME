// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  contractClient,
  type ContractRequest,
  type MoveOutProposalSettlement,
} from '../../../../packages/client-core/src/contracts';

const navigation = vi.hoisted(() => ({ go: vi.fn() }));
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => navigation,
}));

vi.mock('../lib/randomUUID', () => ({
  randomUUID: () => 'c353627c-64f3-4961-b606-c16455c85369',
}));
vi.mock('../theme/theme', () => ({
  colors: {
    navy: '#001637',
    blue: '#1052cf',
    white: '#ffffff',
    border: '#e2e8f0',
    muted: '#64748b',
    green: '#168565',
    red: '#ba1a1a',
  },
}));
vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Modal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
    visible ? <div role="dialog">{children}</div> : null,
  StyleSheet: { create: <T,>(value: T) => value, hairlineWidth: 1 },
  useWindowDimensions: () => ({ width: 320, height: 741, scale: 1, fontScale: 1 }),
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Button: ({
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
  TouchableRipple: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    accessibilityLabel: string;
  }) => (
    <button aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
  Checkbox: {
    Item: ({
      label,
      status,
      onPress,
      disabled,
    }: {
      label: string;
      status: string;
      onPress: () => void;
      disabled?: boolean;
    }) => (
      <input
        type="checkbox"
        aria-label={label}
        checked={status === 'checked'}
        onChange={onPress}
        disabled={disabled}
      />
    ),
  },
  TextInput: ({
    label,
    value,
    onChangeText,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
  }) => (
    <textarea
      aria-label={label}
      value={value}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
}));
vi.mock('../components/WorkspaceKit', () => ({
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
vi.mock('../features/contracts/ContractEvidence', () => ({
  ContractEvidence: ({ evidenceId, label }: { evidenceId: string; label: string }) => (
    <div data-testid="private-evidence">
      {label}: {evidenceId}
    </div>
  ),
}));
vi.mock('../features/contracts/moveOut/TenantMoveOutExcessPayment', () => ({
  TenantMoveOutExcessPayment: () => (
    <div data-testid="excess-payment">Đang kiểm tra phần vượt cọc</div>
  ),
}));

import { TenantMoveOutProposalPanel } from '../features/contracts/moveOut/TenantMoveOutProposalPanel';

afterEach(() => {
  cleanup();
  navigation.go.mockClear();
});

const contractId = '7a6c4943-5c80-4757-bc6e-e75dd0d615d8';
const proposalId = '8e00921b-cc9f-4d46-9192-4fecc963bdf3';
const proposalPath = `/api/v1/contracts/${contractId}/move-out/receivables/proposal`;

it('switches the accepted 20k proposal to completed when the verified server move-out closes', async () => {
  const changed = vi.fn();
  const request = vi.fn<ContractRequest>(async <T,>(path: string): Promise<T> => {
    if (path === proposalPath) return proposal('Accepted') as T;
    if (path === `/api/v1/contracts/${contractId}/move-out`) return { status: 'Completed' } as T;
    throw new Error(`Unexpected API: ${path}`);
  });
  const api = contractClient(
    <T,>(path: string, init?: RequestInit) => request(path, init) as Promise<T>,
  );
  render(<TenantMoveOutProposalPanel api={api} contractId={contractId} onChanged={changed} />);
  expect((await screen.findAllByText('Trả phòng thành công')).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText('Chênh lệch tại thời điểm phát hành')).toBeTruthy();
  expect(screen.getByText('Phí trả phòng đã chốt')).toBeTruthy();
  expect(screen.queryByTestId('excess-payment')).toBeNull();
  expect(screen.queryByText(/Dự kiến cần thanh toán thêm/)).toBeNull();
  // The completion callback runs in a passive effect after the verified
  // completion UI has rendered; wait for that effect rather than racing it.
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
});

function proposal(
  status: 'PendingTenant' | 'Accepted' | 'Disputed' | 'Outdated' = 'PendingTenant',
) {
  return {
    contractId,
    reference: 'inspect-source-v3',
    inspectionId: '1e795e2b-e1c2-49f4-b6aa-c999397d49d9',
    inspectionVersion: 3,
    verifiedDeposit: '3000000',
    availableDeposit: '2800000',
    existingOutstanding: '200000',
    status,
    items: [
      {
        kind: 'RoomCheck',
        roomCheckCode: 'Wall',
        label: 'Tường phòng',
        baseline: 'Tốt',
        observed: 'Trầy xước',
        evidenceIds: ['a-image-id'],
      },
    ],
    latestProposal: {
      id: proposalId,
      items: [
        {
          kind: 'RoomCheck',
          roomCheckCode: 'Wall',
          amount: '3500000',
          reason: 'Sơn lại khu vực bị trầy',
        },
      ],
      verifiedDeposit: '3000000',
      availableDeposit: '2800000',
      existingOutstanding: '200000',
      totalCharges: '3500000',
      signedBalance: '-900000',
      note: 'Đã đối chiếu hiện trạng',
      tenantFeedback:
        status === 'PendingTenant'
          ? null
          : {
              proposalId,
              confirmed: status === 'Accepted',
              reason: '',
              settlement:
                status === 'Accepted'
                  ? ({
                      status: 'Payable',
                      payableAmount: '900000',
                      refundAmount: '0',
                      payableReceivableId: 'a1111111-1111-4111-8111-111111111111' as string | null,
                      createdReceivableIds: [],
                      depositOffsetIds: [],
                    } as MoveOutProposalSettlement)
                  : null,
            },
    },
  };
}

function issuedProposal(status: 'Payable' | 'RefundEligible' | 'PendingOwnerReview') {
  const previous = proposal('Accepted');
  const settlement: MoveOutProposalSettlement = {
    status,
    payableAmount: status === 'Payable' ? '900000' : '0',
    refundAmount: status === 'RefundEligible' ? '150000' : '0',
    payableReceivableId: status === 'Payable' ? 'a1111111-1111-4111-8111-111111111111' : null,
    createdReceivableIds: [],
    depositOffsetIds: [],
  };
  return {
    ...previous,
    status: 'Issued',
    latestProposal: {
      ...previous.latestProposal,
      signedBalance: status === 'RefundEligible' ? '150000' : '-900000',
      tenantFeedback: null,
      issuedSettlement: settlement,
    },
  };
}

it('shows issued charges and QR without Tenant approval or feedback mutation', async () => {
  const request = vi.fn<ContractRequest>(async <T,>(path: string): Promise<T> => {
    if (path === proposalPath) return issuedProposal('Payable') as T;
    if (path.endsWith('/move-out')) return { status: 'PendingSettlement' } as T;
    throw new Error('Unexpected request');
  });
  const api = contractClient(<T,>(path: string, init?: RequestInit) => request(path, init) as Promise<T>);
  render(<TenantMoveOutProposalPanel api={api} contractId={contractId} onChanged={vi.fn()} />);
  expect(await screen.findByText('Tường phòng')).toBeTruthy();
  expect(screen.getByText('Sơn lại khu vực bị trầy')).toBeTruthy();
  expect(screen.getByText(/−900.000/)).toBeTruthy();
  expect(screen.getByText(/Khoản phải thu còn nợ/)).toBeTruthy();
  expect(screen.queryByTestId('private-evidence')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết Tường phòng' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.queryByText('Lúc bàn giao')).toBeNull();
  expect(screen.getByText('Hiện tại')).toBeTruthy();
  expect(screen.getByTestId('private-evidence').textContent).toContain('Ảnh bằng chứng 1');
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  expect(screen.getByText('Đã gửi phí quyết toán')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Đồng ý với đề xuất' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Yêu cầu xem xét lại' })).toBeNull();
  expect(screen.getByTestId('excess-payment')).toBeTruthy();
  expect(request.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
});

it('keeps outdated evidence isolated and never offers acceptance or dispute', async () => {
  const api = contractClient(<T,>() => Promise.resolve(proposal('Outdated') as T));
  render(<TenantMoveOutProposalPanel api={api} contractId={contractId} onChanged={vi.fn()} />);
  expect(await screen.findByText(/Đề xuất cũ đã thay đổi/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Đồng ý với đề xuất' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Yêu cầu xem xét lại' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết Tình trạng phòng' }));
  expect(screen.queryByTestId('private-evidence')).toBeNull();
  expect(screen.queryByTestId('excess-payment')).toBeNull();
});

it('opens prefilled refund directly when Owner issues a refundable balance', async () => {
  const api = contractClient(<T,>(path: string) =>
    Promise.resolve((path === proposalPath ? issuedProposal('RefundEligible') : { status: 'PendingSettlement' }) as T),
  );
  render(<TenantMoveOutProposalPanel api={api} contractId={contractId} onChanged={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Gửi đơn hoàn tiền' }));
  expect(navigation.go).toHaveBeenCalledWith('refund-requests', {
    sourceContractId: contractId,
    amount: '150000',
    moveOutProposalId: proposalId,
    reason: 'Đề nghị hoàn cọc theo quyết toán trả phòng.',
  });
  expect(screen.queryByRole('button', { name: 'Đồng ý với đề xuất' })).toBeNull();
});

it('does not offer QR or refund when accepted proposal still needs Owner review', async () => {
  const api = contractClient(<T,>(path: string) => {
    if (path.endsWith('/move-out')) return Promise.resolve({ status: 'Inspected' } as T);
    if (path !== proposalPath) throw new Error(`Unexpected request ${path}`);
    const view = proposal('Accepted');
    view.latestProposal.signedBalance = '150000';
    if (view.latestProposal.tenantFeedback) {
      view.latestProposal.tenantFeedback.settlement = {
        status: 'PendingOwnerReview',
        payableAmount: '0',
        refundAmount: '0',
        payableReceivableId: null,
        createdReceivableIds: [],
        depositOffsetIds: [],
      };
    }
    return Promise.resolve(view as T);
  });
  render(<TenantMoveOutProposalPanel api={api} contractId={contractId} onChanged={vi.fn()} />);
  expect(await screen.findByText('Đang chờ đối chiếu quyết toán')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Gửi đơn hoàn tiền' })).toBeNull();
  expect(screen.queryByTestId('excess-payment')).toBeNull();
});

it.each(['Accepted', 'Outdated'] as const)(
  'never auto-reconciles a historical proposal marked %s',
  async (status) => {
    const posts = vi.fn();
    const api = contractClient(<T,>(path: string, init?: RequestInit) => {
      if (init?.method === 'POST') posts();
      if (path.endsWith('/move-out')) return Promise.resolve({ status: 'PendingSettlement' } as T);
      const view = proposal(status);
      if (view.latestProposal.tenantFeedback) {
        view.latestProposal.tenantFeedback.confirmed = true;
        view.latestProposal.tenantFeedback.settlement = {
          status: 'PendingOwnerReview',
          payableAmount: '0',
          refundAmount: '0',
          payableReceivableId: null,
          createdReceivableIds: [],
          depositOffsetIds: [],
          reason: 'owner_confirmed_inspection_required',
        };
      }
      return Promise.resolve(view as T);
    });
    render(<TenantMoveOutProposalPanel api={api} contractId={contractId} onChanged={vi.fn()} />);
    expect(await screen.findByText(status === 'Accepted' ? 'Đang chờ đối chiếu quyết toán' : /Đề xuất cũ đã thay đổi/)).toBeTruthy();
    expect(posts).not.toHaveBeenCalled();
    expect(screen.queryByTestId('excess-payment')).toBeNull();
  },
);

it.each([
  'verified_staff_final_inspection_required',
  'existing_obligations_require_owner_review',
  'multiple_payable_obligations_require_review',
  'owner_verified_item_evidence_required',
])('does not auto-reconcile a genuine finance or evidence blocker: %s', async (reason) => {
  const reconciles = vi.fn();
  const api = contractClient(<T,>(path: string) => {
    if (path === `${proposalPath}/reconcile`) {
      reconciles();
      return Promise.reject(new Error('Must not reconcile'));
    }
    const view = proposal('Accepted');
    if (view.latestProposal.tenantFeedback) {
      view.latestProposal.tenantFeedback.settlement = {
        status: 'PendingOwnerReview',
        payableAmount: '0',
        refundAmount: '0',
        payableReceivableId: null,
        createdReceivableIds: [],
        depositOffsetIds: [],
        reason,
      };
    }
    return Promise.resolve(view as T);
  });
  render(<TenantMoveOutProposalPanel api={api} contractId={contractId} onChanged={vi.fn()} />);
  expect(await screen.findByText('Đang chờ đối chiếu quyết toán')).toBeTruthy();
  expect(reconciles).not.toHaveBeenCalled();
  expect(screen.queryByTestId('excess-payment')).toBeNull();
});

it('does not attempt legacy reconciliation on repeated renders', async () => {
  const attempts = vi.fn();
  const api = contractClient(<T,>(path: string, init?: RequestInit) => {
    if (init?.method === 'POST') attempts();
    if (path.endsWith('/move-out')) return Promise.resolve({ status: 'PendingSettlement' } as T);
    return Promise.resolve(issuedProposal('PendingOwnerReview') as T);
  });
  const changed = vi.fn();
  const { rerender } = render(
    <TenantMoveOutProposalPanel api={api} contractId={contractId} onChanged={changed} />,
  );
  expect(await screen.findByText('Đang chờ đối chiếu quyết toán')).toBeTruthy();
  rerender(<TenantMoveOutProposalPanel api={api} contractId={contractId} onChanged={changed} />);
  expect(attempts).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
});
