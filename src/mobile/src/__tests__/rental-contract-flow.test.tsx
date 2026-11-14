// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ContractView, Readiness } from '../../../../packages/client-core/src/contracts';
import type { MainDraftView } from '../../../../packages/client-core/src/mainDrafts';
const state = vi.hoisted(() => ({ request: vi.fn(), roles: ['Owner'] }));
const transport = { request: state.request };
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({ api: transport, session: { roles: state.roles } }),
}));
vi.mock('../lib/randomUUID', () => ({ randomUUID: () => '10000000-0000-4000-8000-000000000001' }));
vi.mock('react-native', () => ({
  StyleSheet: { create: (value: unknown) => value },
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => ({
  MD3LightTheme: { colors: {} },
  configureFonts: () => ({}),
  Icon: () => null,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
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
  Checkbox: {
    Item: ({
      label,
      status,
      disabled,
      onPress,
    }: {
      label: string;
      status: string;
      disabled: boolean;
      onPress: () => void;
    }) => (
      <label>
        <input
          type="checkbox"
          checked={status === 'checked'}
          disabled={disabled}
          onChange={onPress}
        />
        {label}
      </label>
    ),
  },
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
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
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock('../components/WorkflowControls', () => ({
  ChoiceField: ({
    label,
    value,
    options,
    disabled,
    onChange,
  }: {
    label: string;
    value: string;
    options: { id: string; label: string }[];
    disabled: boolean;
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Chọn</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock('../features/contracts/ContractActionForm', () => ({
  ContractActionForm: ({
    onSuccess,
    action,
  }: {
    onSuccess: () => void;
    action: { operation: string };
  }) => <button onClick={() => onSuccess()}>Submit {action.operation}</button>,
  SigningCertificates: () => null,
}));
vi.mock('../features/contracts/ContractEvidence', () => ({ ContractEvidence: () => null }));
vi.mock('../features/contracts/ContractWorkflowPanel', () => ({
  ContractWorkflowPanel: () => <span>Private documents</span>,
}));
vi.mock('../features/contracts/ContractPdfPreview', () => ({
  ContractPdfPreview: ({ document }: { document: { id: string } }) => (
    <span>Private PDF {document.id}</span>
  ),
}));
import { RentalContractFlow } from '../features/contracts/RentalContractFlow';
import { MainDraftSigningReview } from '../features/contracts/MainDraftSigningReview';
import { mainDraftClient } from '../../../../packages/client-core/src/mainDrafts';
import { rentalContractState } from '../features/contracts/rentalContractState';

function contract(): ContractView {
  return {
    id: 'contract',
    locationId: 'location',
    roomId: 'room',
    roomNumber: 'S101',
    locationName: 'Cơ sở tổng hợp',
    kind: 'Main',
    status: 'PendingSigning',
    startDate: '2026-11-09',
    endDate: '2027-11-09',
    monthlyRent: '3000000',
    requiredDeposit: '3000000',
    appliedHoldingDeposit: '0',
    terms: 'Điều khoản thử nghiệm',
    signatures: [],
    ownerSignerId: 'owner',
    tenantUserId: 'tenant',
    residentIds: ['resident'],
    representativeResidentId: 'resident',
    activatedAt: null,
    previousContractId: null,
    holdingContractId: null,
    occupants: [{ id: 'resident', label: 'Đại diện tổng hợp', representative: true }],
  };
}
const ready: Readiness = {
  ready: true,
  blockers: [],
  remainingDeposit: '0',
  verifiedDeposit: '3000000',
};
function flow(c = contract(), role = 'Owner', readiness: Readiness | null = null) {
  const reload = vi.fn(),
    list = vi.fn();
  const api = { transport: state.request } as never;
  render(
    <RentalContractFlow
      api={api}
      contract={c}
      role={role}
      actorId={role === 'Tenant' ? 'tenant' : role === 'Owner' ? 'owner' : 'staff'}
      readiness={readiness}
      onChanged={reload}
      onList={list}
    />,
  );
  return { reload, list };
}
beforeEach(() => {
  state.request.mockReset();
  state.roles = ['Owner'];
});
afterEach(cleanup);
it('labels completed Development signing as simulated while allowing inspection of the remaining conditions', () => {
  const c = contract();
  c.isDevelopmentDemo = true;
  c.signatures = ['owner', 'tenant'].map((id) => ({
    id,
    signerUserId: id,
    status: 'Simulated',
    signedAt: null,
  }));
  flow(c);
  expect(screen.getAllByText('Đã mô phỏng')).toHaveLength(2);
  expect(screen.queryByText('Đã ký')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  expect(screen.getByText('Chưa có QR tiền cọc')).toBeTruthy();
  expect(rentalContractState(c, null).completed).not.toContain('sign');
});
it('keeps one-sided and simulated signatures at signing, without marking payment complete', () => {
  const c = contract();
  c.signatures = [
    { id: 's', signerUserId: 'owner', status: 'Signed', signedAt: null },
    { id: 't', signerUserId: 'tenant', status: 'Simulated', signedAt: null },
  ];
  expect(rentalContractState(c, null)).toMatchObject({
    current: 1,
    signed: false,
    completed: ['preview'],
  });
  flow(c);
  expect(screen.getByText('Bước 2/4 · Ký hợp đồng')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Tiếp tục' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});
it('shows a missing QR honestly and never invents transfer references or marks a payment paid', () => {
  const c = contract();
  c.status = 'PendingActivation';
  c.signatures = ['owner', 'tenant'].map((id) => ({
    id,
    signerUserId: id,
    status: 'Signed',
    signedAt: null,
  }));
  flow(c, 'Tenant', {
    ...ready,
    ready: false,
    remainingDeposit: '3000000',
    verifiedDeposit: '0',
    blockers: ['security_deposit_insufficient'],
  });
  expect(screen.getByText('Bước 3/4 · Tạo mã QR')).toBeTruthy();
  expect(screen.getByText('Chưa có QR tiền cọc')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Tôi đã thanh toán' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra kích hoạt' }));
  expect(screen.getByText('Chưa đối chiếu đủ cọc')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Kích hoạt hợp đồng' })).toBeNull();
  expect(state.request).not.toHaveBeenCalled();
});
it('keeps activation blocked for Owner when backend readiness is false', () => {
  const c = contract();
  c.signatures = ['owner', 'tenant'].map((id) => ({
    id,
    signerUserId: id,
    status: 'Signed',
    signedAt: null,
  }));
  flow(c, 'Owner', { ...ready, ready: false, blockers: ['effective_date_not_reached'] });
  expect(
    (screen.getByRole('button', { name: 'Kích hoạt hợp đồng' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.queryByText('Hợp đồng đã được kích hoạt')).toBeNull();
});
it('renders success only from Active and returns to the existing list', () => {
  const c = contract();
  c.status = 'Active';
  const { list } = flow(c);
  expect(screen.getByText('Hợp đồng đã được kích hoạt')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Quay về danh sách hợp đồng' }));
  expect(list).toHaveBeenCalledOnce();
});
it('does not offer Owner signing or financial controls to Staff', () => {
  flow(contract(), 'Staff');
  expect(screen.queryByRole('button', { name: 'Yêu cầu ký MySign' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Xác minh cọc ngân hàng' })).toBeNull();
});
it('allows Owner release only with an actual reviewed file, selected Tenant and explicit confirmation, preventing double submission', async () => {
  let resolve!: (value: unknown) => void;
  state.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/accounts')) return [{ id: 'tenant', label: 'Tenant tổng hợp' }];
    if (path.endsWith('/signing-review')) return { id: 'review', developmentOnly: true };
    if (path.endsWith('/release'))
      return new Promise((done) => {
        resolve = done;
      });
    throw new Error('Unexpected test request');
  });
  const released = vi.fn();
  render(
    <MainDraftSigningReview
      client={mainDraftClient(state.request)}
      draft={{ id: 'draft', version: 4 } as MainDraftView}
      onReleased={released}
      onOpenPdf={vi.fn()}
    />,
  );
  const submit = screen.getByRole('button', {
    name: 'Xác nhận chuyển sang ký',
  }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  await screen.findByText('Tenant tổng hợp');
  fireEvent.change(screen.getByLabelText('Tài khoản Tenant đại diện'), {
    target: { value: 'tenant' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo PDF đưa đi ký' }));
  await screen.findByText('Private PDF review');
  expect(submit.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(submit);
  fireEvent.click(submit);
  await waitFor(() => expect(typeof resolve).toBe('function'));
  const calls = state.request.mock.calls.filter((call) => call[0].endsWith('/release'));
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0][1].body)).toEqual({
    tenantUserId: 'tenant',
    expectedVersion: 4,
    reviewedFileId: 'review',
    humanReviewed: true,
  });
  expect(released).not.toHaveBeenCalled();
  resolve({ id: 'draft' });
  await waitFor(() => expect(released).toHaveBeenCalledWith('draft'));
});
it('shows Staff handoff without requesting accounts, signing-review or release', () => {
  state.roles = ['Staff'];
  render(
    <MainDraftSigningReview
      client={mainDraftClient(state.request)}
      draft={{ id: 'draft' } as MainDraftView}
      onReleased={vi.fn()}
      onOpenPdf={vi.fn()}
    />,
  );
  expect(screen.getByText('Chờ Chủ cơ sở duyệt để ký')).toBeTruthy();
  expect(state.request).not.toHaveBeenCalled();
});
it('allows Owner to release a reviewed Main draft without a Tenant account for email OTP signing', async () => {
  state.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/accounts')) return [];
    if (path.endsWith('/signing-review')) return { id: 'review-new', developmentOnly: true };
    if (path.endsWith('/release')) return { id: 'draft-new' };
    throw new Error('Unexpected test request');
  });
  const released = vi.fn();
  render(
    <MainDraftSigningReview
      client={mainDraftClient(state.request)}
      draft={{ id: 'draft-new', version: 2 } as MainDraftView}
      onReleased={released}
      onOpenPdf={vi.fn()}
    />,
  );
  await screen.findByText(
    'Chưa có tài khoản Tenant. Người ở mới ký qua email và OTP; tài khoản chỉ được cấp sau khi hợp đồng kích hoạt.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tạo PDF đưa đi ký' }));
  await screen.findByText('Private PDF review-new');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận chuyển sang ký' }));
  await waitFor(() => expect(released).toHaveBeenCalledWith('draft-new'));
  const call = state.request.mock.calls.find(([path]) => path.endsWith('/release'));
  expect(JSON.parse(call![1].body)).toEqual({
    tenantUserId: null,
    expectedVersion: 2,
    reviewedFileId: 'review-new',
    humanReviewed: true,
  });
});
