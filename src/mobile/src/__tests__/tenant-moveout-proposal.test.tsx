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
vi.mock('../features/contracts/TenantMoveOutExcessPayment', () => ({
  TenantMoveOutExcessPayment: () => (
    <div data-testid="excess-payment">Đang kiểm tra phần vượt cọc</div>
  ),
}));

import { TenantMoveOutProposalPanel } from '../features/contracts/TenantMoveOutProposalPanel';

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
  expect(screen.getByText('Không còn phải thanh toán')).toBeTruthy();
  expect(screen.getByText('Phí trả phòng đã chốt')).toBeTruthy();
  expect(screen.queryByTestId('excess-payment')).toBeNull();
  expect(screen.queryByText(/Dự kiến cần thanh toán thêm/)).toBeNull();
  expect(changed).toHaveBeenCalledOnce();
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

it('Tenant sees itemized charges, signs off only after reviewing and sends idempotent proposal feedback', async () => {
  let status: 'PendingTenant' | 'Accepted' = 'PendingTenant';
  const sent: { path: string; init: RequestInit | undefined }[] = [];
  const request = vi.fn<ContractRequest>(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (path === proposalPath) return proposal(status) as T;
      if (path === `${proposalPath}/tenant-feedback`) {
        sent.push({ path, init });
        status = 'Accepted';
        return { id: 'feedback' } as T;
      }
      throw new Error(`Unexpected API: ${path}`);
    },
  );
  const api = contractClient(
    <T,>(path: string, init?: RequestInit) => request(path, init) as Promise<T>,
  );
  const changed = vi.fn();
  render(<TenantMoveOutProposalPanel api={api} contractId={contractId} onChanged={changed} />);

  expect(await screen.findByText('Tường phòng')).toBeTruthy();
  expect(screen.getByText('Sơn lại khu vực bị trầy')).toBeTruthy();
  expect(screen.getByText(/−900.000/)).toBeTruthy();
  expect(screen.getByText(/Khoản phải thu còn nợ/)).toBeTruthy();
  expect(screen.queryByTestId('private-evidence')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết Tường phòng' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.queryByText('Lúc bàn giao')).toBeNull();
  expect(screen.queryByText('Khi trả phòng')).toBeNull();
  expect(screen.getByText('Hiện tại')).toBeTruthy();
  expect(screen.getByTestId('private-evidence').textContent).toContain('Ảnh bằng chứng 1');
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý với đề xuất' }));
  expect(
    (screen.getByRole('button', { name: 'Gửi xác nhận đồng ý' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Tôi đã xem các khoản thu và đồng ý' }));
  fireEvent.click(screen.getByRole('button', { name: 'Gửi xác nhận đồng ý' }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(sent).toHaveLength(1);
  expect(sent[0].init?.headers).toEqual({
    'Idempotency-Key': 'c353627c-64f3-4961-b606-c16455c85369',
  });
  expect(JSON.parse(String(sent[0].init?.body))).toEqual({
    proposalId,
    expectedReference: 'inspect-source-v3',
    confirmed: true,
    reason: '',
  });
  expect(await screen.findByText('Bạn đã đồng ý')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Đồng ý với đề xuất' })).toBeNull();
  expect(screen.getByTestId('excess-payment')).toBeTruthy();
});

it('Outdated proposal cannot be accepted, and disputing an active proposal requires a reason', async () => {
  const sent: string[] = [];
  let state: 'Outdated' | 'PendingTenant' = 'Outdated';
  const api = contractClient(<T,>(path: string, init?: RequestInit) => {
    if (path === proposalPath) return Promise.resolve(proposal(state) as T);
    if (path.endsWith('/tenant-feedback')) {
      sent.push(String(init?.body));
      return Promise.resolve({} as T);
    }
    throw new Error('Unexpected request');
  });
  const { rerender } = render(
    <TenantMoveOutProposalPanel
      key="outdated"
      api={api}
      contractId={contractId}
      onChanged={vi.fn()}
    />,
  );
  expect(await screen.findByText(/Đề xuất cũ đã thay đổi/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Đồng ý với đề xuất' })).toBeNull();
  // Stale proposals must not pick the room/asset label or evidence from a newer inspection.
  fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết Tình trạng phòng' }));
  expect(screen.queryByText('Lúc bàn giao')).toBeNull();
  expect(screen.queryByTestId('private-evidence')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));

  state = 'PendingTenant';
  rerender(
    <TenantMoveOutProposalPanel
      key="active"
      api={api}
      contractId={contractId}
      onChanged={vi.fn()}
    />,
  );
  expect(await screen.findByText('Chờ bạn phản hồi')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Tải lại đề xuất' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu xem xét lại' }));
  expect(
    (screen.getByRole('button', { name: 'Gửi yêu cầu xem xét lại' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('Lý do yêu cầu xem xét lại'), {
    target: { value: 'Số tiền chưa phù hợp với tình trạng thực tế.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu xem xét lại' }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(JSON.parse(sent[0])).toMatchObject({
    proposalId,
    confirmed: false,
    reason: 'Số tiền chưa phù hợp với tình trạng thực tế.',
  });
});

it('submits line-specific objections to Owner and only shows refund navigation after accepted positive balance', async () => {
  const sent: string[] = [];
  let status: 'PendingTenant' | 'Accepted' = 'PendingTenant';
  const api = contractClient(<T,>(path: string, init?: RequestInit) => {
    if (path === proposalPath) {
      const view = proposal(status);
      view.latestProposal.signedBalance = '150000';
      if (view.latestProposal.tenantFeedback)
        view.latestProposal.tenantFeedback.settlement = {
          status: 'RefundEligible',
          payableAmount: '0',
          refundAmount: '150000',
          payableReceivableId: null,
          createdReceivableIds: [],
          depositOffsetIds: [],
        };
      return Promise.resolve(view as T);
    }
    if (path.endsWith('/tenant-feedback')) {
      sent.push(String(init?.body));
      return Promise.resolve({} as T);
    }
    throw new Error(`Unexpected request ${path}`);
  });
  const { rerender } = render(
    <TenantMoveOutProposalPanel api={api} contractId={contractId} onChanged={vi.fn()} />,
  );
  expect(await screen.findByText('Chờ bạn phản hồi')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Gửi đơn hoàn tiền' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu xem xét lại' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Tường phòng · 3.500.000/ }));
  expect(
    (screen.getByRole('button', { name: 'Gửi yêu cầu xem xét lại' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('Lý do chưa đồng ý Tường phòng'), {
    target: { value: 'Ảnh chưa thể hiện vết xước.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu xem xét lại' }));
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(JSON.parse(sent[0])).toMatchObject({
    reason: '',
    disputedItems: [
      {
        kind: 'RoomCheck',
        assetId: null,
        roomCheckCode: 'Wall',
        accessType: null,
        reason: 'Ảnh chưa thể hiện vết xước.',
      },
    ],
  });

  status = 'Accepted';
  rerender(
    <TenantMoveOutProposalPanel
      key="accepted"
      api={api}
      contractId={contractId}
      onChanged={vi.fn()}
    />,
  );
  const refund = await screen.findByRole('button', { name: 'Gửi đơn hoàn tiền' });
  fireEvent.click(refund);
  expect(navigation.go).toHaveBeenCalledWith('refund-requests', {
    sourceContractId: contractId,
    amount: '150000',
    moveOutProposalId: proposalId,
    reason: 'Đề nghị hoàn cọc sau khi xác nhận quyết toán trả phòng.',
  });
});

it('does not offer QR or refund when accepted proposal still needs Owner review', async () => {
  const api = contractClient(<T,>(path: string) => {
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
  'automatically reconciles a legacy confirmed proposal marked %s and reveals the server-issued QR obligation',
  async (initialStatus) => {
    let reconciled = false;
    let getCount = 0;
    const posts: { path: string; init?: RequestInit }[] = [];
    const request = vi.fn<ContractRequest>(
      async <T,>(path: string, init?: RequestInit): Promise<T> => {
        if (path === proposalPath) {
          getCount++;
          const view = proposal(reconciled ? 'Accepted' : initialStatus);
          if (!reconciled && view.latestProposal.tenantFeedback) {
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
          return view as T;
        }
        if (path === `${proposalPath}/reconcile`) {
          posts.push({ path, init });
          reconciled = true;
          return {
            proposalId,
            confirmed: true,
            settlement: {
              status: 'Payable',
              payableAmount: '900000',
              refundAmount: '0',
              payableReceivableId: 'a1111111-1111-4111-8111-111111111111',
            },
          } as T;
        }
        throw new Error(`Unexpected API: ${path}`);
      },
    );
    const api = contractClient(
      <T,>(path: string, init?: RequestInit) => request(path, init) as Promise<T>,
    );
    const changed = vi.fn();
    const { rerender } = render(
      <TenantMoveOutProposalPanel api={api} contractId={contractId} onChanged={changed} />,
    );

    expect(await screen.findByTestId('excess-payment')).toBeTruthy();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      path: `${proposalPath}/reconcile`,
      init: { method: 'POST', body: JSON.stringify({ proposalId }) },
    });
    expect(posts[0].init?.headers).toBeUndefined();
    expect(getCount).toBe(2);
    expect(changed).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Đồng ý với đề xuất' })).toBeNull();
    rerender(<TenantMoveOutProposalPanel api={api} contractId={contractId} onChanged={changed} />);
    expect(posts).toHaveLength(1);
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

it('attempts failed legacy reconciliation only once despite repeated renders', async () => {
  const attempts = vi.fn();
  const api = contractClient(<T,>(path: string) => {
    if (path === `${proposalPath}/reconcile`) {
      attempts();
      return Promise.reject(new Error('Temporary transport error'));
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
        reason: 'owner_confirmed_inspection_required',
      };
    }
    return Promise.resolve(view as T);
  });
  const changed = vi.fn();
  const { rerender } = render(
    <TenantMoveOutProposalPanel api={api} contractId={contractId} onChanged={changed} />,
  );
  expect(await screen.findByText(/Chưa thể hoàn tất đối chiếu tự động/)).toBeTruthy();
  expect(attempts).toHaveBeenCalledOnce();
  expect(changed).not.toHaveBeenCalled();
  rerender(<TenantMoveOutProposalPanel api={api} contractId={contractId} onChanged={changed} />);
  expect(attempts).toHaveBeenCalledOnce();
});
