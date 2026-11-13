// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { contractClient, type ContractView } from '../../../../packages/client-core/src/contracts';
import type { InternalSigningStatus } from '../../../../packages/client-core/src/internalSigning';
const state = vi.hoisted(() => ({
  request: vi.fn(),
  reload: vi.fn(),
  changed: vi.fn(),
  role: 'Owner',
  status: null as InternalSigningStatus | null,
}));
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ session: { userId: id, roles: [state.role] } }),
}));
vi.mock('../features/workspace/useWorkspaceQuery', () => ({
  useWorkspaceQuery: () => ({
    data: state.status,
    error: '',
    loading: !state.status,
    reload: state.reload,
  }),
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Checkbox: {
    Item: ({
      label,
      onPress,
      disabled,
    }: {
      label: string;
      onPress: () => void;
      disabled: boolean;
    }) => (
      <button role="checkbox" disabled={disabled} onClick={onPress}>
        {label}
      </button>
    ),
  },
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
  Box: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
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
const input = ({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) => (
  <input
    aria-label={label}
    value={value}
    disabled={disabled}
    onChange={(e) => onChange(e.target.value)}
  />
);
vi.mock('../components/WorkflowControls', () => ({
  Input: (props: Parameters<typeof input>[0]) => input(props),
}));
vi.mock('../components/ContractDateField', () => ({
  ContractDateField: (props: Parameters<typeof input>[0]) => input(props),
}));
vi.mock('../features/contracts/ContractEvidence', () => ({
  ContractEvidence: () => <span>PDF xác nhận</span>,
}));
import { OwnerHoldingSigning } from '../features/owner/OwnerHoldingSigning';
const contract = {
  id,
  ownerSignerId: id,
  kind: 'Holding',
  status: 'PendingSigning',
  approvedAt: '2026-11-13T00:00:00Z',
  signingMode: 'INTERNAL_OTP_DRAWN',
  snapshotHash: 'saved-snapshot',
  occupants: [],
} as unknown as ContractView;
const api = contractClient(state.request);
const mount = (c = contract) =>
  render(<OwnerHoldingSigning api={api} contract={c} onChanged={state.changed} />);
beforeEach(() => {
  state.role = 'Owner';
  state.status = {
    mode: 'INTERNAL_OTP_DRAWN',
    state: 'AwaitingAcceptance',
    documentHash: null,
    tenantAcceptedAt: null,
    ownerAcceptedAt: null,
    invitations: [],
  };
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});
it('gates confirmation on backend recipient evidence and refreshes after a single confirmed mutation', async () => {
  const view = mount();
  expect(screen.queryByText('Xác nhận chấp thuận của Owner')).toBeNull();
  state.status = {
    ...state.status!,
    tenantAcceptedAt: '2026-11-13T00:00:00Z',
    documentHash: 'exact-pdf',
  };
  view.rerender(<OwnerHoldingSigning api={api} contract={contract} onChanged={state.changed} />);
  const confirm = screen.getByRole('button', { name: 'Xác nhận chấp thuận của Owner' });
  expect(confirm.hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  let finish!: () => void;
  state.request.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(state.request).toHaveBeenCalledTimes(1);
  expect(state.request.mock.calls[0]![0]).toBe(
    `/api/v1/contracts/${id}/internal-signing/owner-confirmation`,
  );
  expect(JSON.parse(state.request.mock.calls[0]![1].body)).toEqual({
    documentHash: 'exact-pdf',
    consent: true,
    consentVersion: 'internal-acceptance-v1',
  });
  finish();
  await waitFor(() => expect(state.changed).toHaveBeenCalledOnce());
  expect(state.reload).toHaveBeenCalledOnce();
});
it('sends an explicitly chosen Vietnam expiry through the existing invitation API without exposing its token', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-13T00:00:00Z'));
  state.request.mockResolvedValue({
    id,
    token: 'PRIVATE-ONE-TIME-TOKEN',
    status: 'InvitationPendingManualDelivery',
  });
  mount();
  fireEvent.change(screen.getByLabelText('Ngày hết hạn lời mời (dd/MM/yyyy)'), {
    target: { value: '13/11/2026' },
  });
  fireEvent.change(screen.getByLabelText('Giờ hết hạn (HH:mm, giờ Việt Nam)'), {
    target: { value: '10:00' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByText('Gửi lời mời ký qua email'));
  await waitFor(() => expect(state.changed).toHaveBeenCalledOnce());
  expect(JSON.parse(state.request.mock.calls[0]![1].body)).toEqual({
    snapshotHash: 'saved-snapshot',
    expiresAt: '2026-11-13T03:00:00.000Z',
  });
  expect(document.body.textContent).not.toContain('PRIVATE-ONE-TIME-TOKEN');
});
it('does not permit invitations before Holding approval or for another role/method', () => {
  let view = mount({ ...contract, approvedAt: null });
  expect(screen.queryByText('Gửi lời mời ký qua email')).toBeNull();
  view.unmount();
  state.role = 'Staff';
  view = mount();
  expect(document.body.textContent).toBe('');
  view.unmount();
  state.role = 'Owner';
  mount({ ...contract, signingMode: 'MYSIGN_SANDBOX' });
  expect(document.body.textContent).toBe('');
  expect(state.request).not.toHaveBeenCalled();
});
it('retains a pending state on provider failure and reloads evidence', async () => {
  state.status = {
    ...state.status!,
    tenantAcceptedAt: '2026-11-13T00:00:00Z',
    documentHash: 'exact-pdf',
  };
  state.request.mockRejectedValue({ status: 503 });
  mount();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByText('Xác nhận chấp thuận của Owner'));
  await screen.findByText('Chưa cấu hình dịch vụ gửi mã hoặc tài liệu. Vui lòng liên hệ Owner.');
  expect(state.changed).not.toHaveBeenCalled();
  expect(state.reload).toHaveBeenCalledOnce();
});
