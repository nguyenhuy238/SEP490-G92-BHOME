// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { contractClient, type ContractView } from '../../../../packages/client-core/src/contracts';
import { ApiError } from '../../../../packages/client-core/src/api';
import { type InternalSigningStatus } from '../../../../packages/client-core/src/internalSigning';
vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => ({
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
      onPress,
      disabled,
    }: {
      label: string;
      status: string;
      onPress: () => void;
      disabled?: boolean;
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
  Heading: ({ title, detail }: { title: string; detail?: string }) => (
    <>
      <h2>{title}</h2>
      <span>{detail}</span>
    </>
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
}));
vi.mock('../features/contracts/ContractEvidence', () => ({
  ContractEvidence: ({ label }: { label?: string }) => <span>{label || 'Tài liệu ký số'}</span>,
}));
vi.mock('../features/contracts/HoldingDepositAllocation', () => ({
  HoldingDepositAllocation: () => <span>Đối chiếu giao dịch Owner</span>,
}));
vi.mock('../features/contracts/ContractActionForm', () => ({
  ContractActionForm: () => <span>Biểu mẫu thao tác có xác nhận</span>,
  SigningCertificates: () => <span>Chọn chứng thư ký số</span>,
}));
import { HoldingContractFlow, invitationLabel } from '../features/contracts/HoldingContractFlow';
const request = vi.fn();
vi.mock('../features/contracts/HoldingProgress', () => ({
  HoldingProgress: ({ current }: { current: number }) => <span>Bước {current + 1}/8</span>,
}));
const api = contractClient(request);
const changed = vi.fn();
let internal: InternalSigningStatus;
let room = 0;
function contract(overrides: Partial<ContractView> = {}): ContractView {
  return {
    id: 'synthetic-contract',
    roomId: 'synthetic-room',
    locationId: 'synthetic-location',
    roomNumber: 'TEST-101',
    locationName: 'Cơ sở kiểm thử',
    kind: 'Holding',
    status: 'Draft',
    startDate: '2026-11-12',
    endDate: '2026-12-12',
    requiredDeposit: '2000000',
    monthlyRent: '2000000',
    terms: 'Điều khoản kiểm thử',
    ownerSignerId: 'owner',
    tenantUserId: null,
    representativeResidentId: 'synthetic-resident',
    residentIds: ['synthetic-resident'],
    signatures: [],
    previousContractId: null,
    holdingContractId: null,
    appliedHoldingDeposit: '0',
    activatedAt: null,
    occupants: [{ id: 'synthetic-resident', label: 'Người kiểm thử', representative: true }],
    signingMode: 'INTERNAL_OTP_DRAWN',
    snapshotHash: 'synthetic-snapshot',
    holdingExpiresAt: '2099-11-12T00:00:00Z',
    ...overrides,
  };
}
function show(c = contract(), role = 'Owner', actorId = 'owner') {
  return render(
    <HoldingContractFlow
      api={api}
      contract={c}
      role={role}
      actorId={actorId}
      readiness={{ ready: false, blockers: [], verifiedDeposit: '0', remainingDeposit: '2000000' }}
      onChanged={changed}
      onList={vi.fn()}
    />,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  room = 0;
  internal = {
    mode: 'INTERNAL_OTP_DRAWN',
    state: 'AwaitingAcceptance',
    documentHash: null,
    tenantAcceptedAt: null,
    ownerAcceptedAt: null,
    invitations: [],
  };
  request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/internal-signing')) return structuredClone(internal);
    if (path.endsWith('/previews')) return [{ id: 'pdf', snapshotHash: 'synthetic-snapshot' }];
    if (path.endsWith('/signing-invitations')) {
      internal.invitations.push({
        id: 'invitation',
        status: 'OwnerApprovedLink',
        expiresAt: '2099-01-01T00:00:00Z',
      });
      return { id: 'invitation', token: 'SECRET-ONE-TIME-TOKEN', status: 'OwnerApprovedLink' };
    }
    if (path.endsWith('/owner-confirmation')) {
      internal.ownerAcceptedAt = '2026-11-12T01:00:00Z';
      return;
    }
    if (path.endsWith('/holding-deposit'))
      return { required: '2000000', verified: '2000000', remaining: '0', status: 'Verified' };
    if (path.includes('/rooms/')) return { status: room };
    if (path.endsWith('/deposit-payment')) return { transferReference: 'BACKEND-REFERENCE' };
    throw new Error(`Unexpected endpoint ${path} ${init?.method || 'GET'}`);
  });
});
afterEach(cleanup);
it('opens persisted draft without recreating it or sending invitations; Staff never requests Owner PDF', async () => {
  show(contract(), 'Staff', 'staff');
  expect(screen.getByText(/5\/8/)).toBeTruthy();
  expect(screen.getByText('Chờ Owner phê duyệt')).toBeTruthy();
  expect(screen.queryByText('Tiếp tục')).toBeNull();
  expect(screen.queryByText('Làm mới trạng thái')).toBeNull();
  expect(screen.queryByText('Xem bản nháp')).toBeNull();
  expect(screen.queryByText('Phê duyệt giữ chỗ')).toBeNull();
  expect(request).not.toHaveBeenCalled();
});
it('blocks progression past approval while backend approval is missing', async () => {
  show(contract(), 'Staff', 'staff');
  expect(screen.queryByText('Tiếp tục')).toBeNull();
  expect(screen.getByText(/Đang chờ Owner phê duyệt hợp đồng/)).toBeTruthy();
});
it('Staff resumes approval-confirmed step with scoped read-only signing status', () => {
  show(contract({ approvedAt: '2026-11-12T00:00:00Z' }), 'Staff', 'staff');
  expect(screen.getByText(/6\/8/)).toBeTruthy();
  expect(screen.queryByText('Tạo lời mời ký')).toBeNull();
  expect(request).toHaveBeenCalledWith('/api/v1/contracts/synthetic-contract/internal-signing');
});
it('requires PDF consent, preflights and prevents duplicate invitations; never exposes token or invents URL/QR', async () => {
  const view = show(contract({ approvedAt: '2026-11-12T00:00:00Z' }));
  await screen.findByText('Xem hợp đồng');
  expect((screen.getByText('Tạo lời mời ký') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByText('Tạo lời mời ký'));
  fireEvent.click(screen.getByText('Tạo lời mời ký'));
  await screen.findByText('Đã tạo lời mời · Chưa xác nhận gửi email');
  expect(request.mock.calls.filter(([p]) => p.endsWith('/signing-invitations'))).toHaveLength(1);
  expect((screen.getByText('Tạo lời mời ký') as HTMLButtonElement).disabled).toBe(true);
  expect(document.body.textContent).not.toContain('SECRET-ONE-TIME-TOKEN');
  expect(document.querySelector('a, canvas')).toBeNull();
  expect(document.body.textContent).not.toContain('MySign');
  view.unmount();
  show(contract({ approvedAt: '2026-11-12T00:00:00Z' }));
  await screen.findByText('Đã tạo lời mời · Chưa xác nhận gửi email');
  expect(request.mock.calls.filter(([p]) => p.endsWith('/signing-invitations'))).toHaveLength(1);
});
it('does not resend an existing invitation after reopening', async () => {
  internal.invitations = [
    { id: 'existing', status: 'InvitationAcceptedByProvider', expiresAt: '2099-01-01T00:00:00Z' },
  ];
  show(contract({ approvedAt: '2026-11-12T00:00:00Z' }));
  await screen.findByText('Dịch vụ email đã tiếp nhận lời mời');
  fireEvent.click(screen.getByRole('checkbox'));
  expect((screen.getByText('Tạo lời mời ký') as HTMLButtonElement).disabled).toBe(true);
  expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

it('allows an explicit retry after a known pre-creation OTP configuration rejection', async () => {
  const original = request.getMockImplementation()!;
  let rejected = false;
  request.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith('/signing-invitations') && !rejected) {
      rejected = true;
      return Promise.reject(new ApiError(503, { code: 'signing_otp_key_not_configured' }));
    }
    return original(path, init);
  });
  show(contract({ approvedAt: '2026-11-12T00:00:00Z' }));
  await screen.findByText('Xem hợp đồng');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByText('Tạo lời mời ký'));
  await screen.findByText(
    'Chưa cấu hình khóa xác minh OTP. Vui lòng liên hệ quản trị viên trước khi tạo lời mời ký.',
  );
  expect(screen.queryByText(/Chưa xác định kết quả tạo lời mời/)).toBeNull();
  expect(request.mock.calls.filter(([path]) => path.endsWith('/signing-invitations'))).toHaveLength(
    1,
  );
  cleanup();
  show(contract({ approvedAt: '2026-11-12T00:00:00Z' }));
  await screen.findByText('Xem hợp đồng');
  fireEvent.click(screen.getByRole('checkbox'));
  await waitFor(() =>
    expect((screen.getByText('Tạo lời mời ký') as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByText('Tạo lời mời ký'));
  await screen.findByText('Đã tạo lời mời · Chưa xác nhận gửi email');
  expect(request.mock.calls.filter(([path]) => path.endsWith('/signing-invitations'))).toHaveLength(
    2,
  );
});
it('requires actual Tenant acceptance before Owner confirmation and uses backend document hash', async () => {
  internal.tenantAcceptedAt = '2026-11-12T00:30:00Z';
  internal.documentHash = 'backend-document-hash';
  show(contract({ approvedAt: '2026-11-12T00:00:00Z' }));
  await screen.findByText('Xem hợp đồng đã ký');
  expect((screen.getByText('Xác nhận chấp thuận') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByText('Xác nhận chấp thuận'));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  const call = request.mock.calls.find(([p]) => p.endsWith('/owner-confirmation'))!;
  expect(JSON.parse(call[1].body)).toEqual({
    documentHash: 'backend-document-hash',
    consent: true,
    consentVersion: 'internal-acceptance-v1',
  });
});
it('does not offer Owner actions to a different Owner account', () => {
  show(contract({ approvedAt: '2026-11-12T00:00:00Z' }), 'Owner', 'different-owner');
  expect(request).not.toHaveBeenCalled();
  expect(screen.queryByText('Tạo lời mời ký')).toBeNull();
});
it('keeps certificate signing separate from internal OTP signing', async () => {
  show(contract({ approvedAt: '2026-11-12T00:00:00Z', signingMode: 'REMOTE_CA' }));
  expect(screen.getByText('Chọn chứng thư ký số')).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
  expect(screen.queryByText('Tạo lời mời ký')).toBeNull();
});
it('does not declare success for Active contract unless backend room is OnHold', async () => {
  show(contract({ status: 'Active' }), 'Staff', 'staff');
  await screen.findByText('Tiền cọc đã được xác minh');
  expect(screen.queryByText('Giữ chỗ thành công')).toBeNull();
  expect(request.mock.calls.some(([p]) => p.endsWith('/deposit-payment'))).toBe(false);
});
it('shows success only after backend confirms Active and OnHold; reads actual transfer reference for Owner', async () => {
  room = 1;
  show(contract({ status: 'Active' }));
  await screen.findByText('Giữ chỗ thành công');
  expect(await screen.findByText('BACKEND-REFERENCE')).toBeTruthy();
  expect(document.querySelector('canvas, img')).toBeNull();
  expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

it('resumes steps 5 to 8 from changed server props and reloads room state after activation', async () => {
  const view = show(contract(), 'Staff', 'staff');
  expect(screen.getByText(/5\/8/)).toBeTruthy();
  function update(status: string, approvedAt: string | null = '2026-11-12T00:00:00Z') {
    view.rerender(
      <HoldingContractFlow
        api={api}
        contract={contract({ status, approvedAt })}
        role="Staff"
        actorId="staff"
        readiness={null}
        onChanged={changed}
        onList={vi.fn()}
      />,
    );
  }
  update('PendingSigning');
  expect(screen.getByText(/6\/8/)).toBeTruthy();
  update('PendingActivation');
  await screen.findByText('Tiền cọc đã được xác minh');
  expect(screen.getByText(/7\/8/)).toBeTruthy();
  expect(screen.queryByText('Giữ chỗ thành công')).toBeNull();
  room = 1;
  update('Active');
  await screen.findByText('Giữ chỗ thành công');
  expect(screen.getByRole('button', { name: 'Hoàn tất' })).toBeTruthy();
  expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
it('keeps unknown delivery statuses neutral and distinguishes delivery failure', () => {
  expect(invitationLabel('unknown')).toBe('Chưa xác định trạng thái gửi lời mời');
  expect(invitationLabel('InvitationPendingManualDelivery')).toContain('Chưa gửi được email');
});
it('does not enable signing actions when Owner status lookup fails', async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation((path: string, init?: RequestInit) =>
    path.endsWith('/internal-signing') ? Promise.reject({ status: 503 }) : original(path, init),
  );
  show(contract({ approvedAt: '2026-11-12T00:00:00Z' }));
  await screen.findByText(/Chưa cấu hình dịch vụ gửi mã hoặc tài liệu/);
  fireEvent.click(screen.getByRole('checkbox'));
  expect((screen.getByText('Tạo lời mời ký') as HTMLButtonElement).disabled).toBe(true);
  expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
it('never confirms Owner acceptance or advances on a failed backend confirmation', async () => {
  internal.tenantAcceptedAt = '2026-11-12T00:30:00Z';
  internal.documentHash = 'backend-document-hash';
  const original = request.getMockImplementation()!;
  request.mockImplementation((path: string, init?: RequestInit) =>
    path.endsWith('/owner-confirmation') ? Promise.reject({ status: 409 }) : original(path, init),
  );
  show(contract({ approvedAt: '2026-11-12T00:00:00Z' }));
  await screen.findByText('Xem hợp đồng đã ký');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByText('Xác nhận chấp thuận'));
  await screen.findByText(/Tài liệu hoặc trạng thái đã thay đổi/);
  expect(changed).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('Owner đã xác nhận:');
  expect(screen.queryByText('Tiếp tục')).toBeNull();
});
it('reuses an existing preview on repeat view and never posts another draft', async () => {
  let generated = false;
  const original = request.getMockImplementation()!;
  request.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith('/previews')) {
      if (init?.method === 'POST') {
        generated = true;
        return Promise.resolve(undefined);
      }
      return Promise.resolve(
        generated ? [{ id: 'generated-pdf', snapshotHash: 'synthetic-snapshot' }] : [],
      );
    }
    return original(path, init);
  });
  const view = show();
  fireEvent.click(await screen.findByText('Xem hợp đồng'));
  await waitFor(() =>
    expect(
      request.mock.calls.filter(([p, init]) => p.endsWith('/previews') && init?.method === 'POST'),
    ).toHaveLength(1),
  );
  await screen.findByText('Xem hợp đồng');
  const post = request.mock.calls.find(
    ([p, init]) => p.endsWith('/previews') && init?.method === 'POST',
  )!;
  expect(post[1].headers['Idempotency-Key']).toBeTruthy();
  view.unmount();
  show();
  await screen.findByText('Xem hợp đồng');
  expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect(request.mock.calls.some(([p]) => p.endsWith('/holdings'))).toBe(false);
});
it('fails closed when invitation request loses its response and never automatically retries POST', async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation((path: string, init?: RequestInit) =>
    path.endsWith('/signing-invitations')
      ? Promise.reject(new Error('Network interrupted'))
      : original(path, init),
  );
  let view = show(contract({ approvedAt: '2026-11-12T00:00:00Z' }));
  await screen.findByText('Xem hợp đồng');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByText('Tạo lời mời ký'));
  await screen.findByText(/Chưa xác định kết quả tạo lời mời/);
  view.unmount();
  view = show(contract({ approvedAt: '2026-11-12T00:00:00Z' }));
  await screen.findByText(/Chưa xác định kết quả tạo lời mời/);
  fireEvent.click(screen.getByRole('checkbox'));
  expect((screen.getByText('Tạo lời mời ký') as HTMLButtonElement).disabled).toBe(true);
  expect(request.mock.calls.filter(([p]) => p.endsWith('/signing-invitations'))).toHaveLength(1);
  view.unmount();
  show(contract({ approvedAt: '2026-11-12T00:00:00Z' }));
  await screen.findByText(/Chưa xác định kết quả tạo lời mời/);
  fireEvent.click(screen.getByRole('checkbox'));
  expect((screen.getByText('Tạo lời mời ký') as HTMLButtonElement).disabled).toBe(true);
});
