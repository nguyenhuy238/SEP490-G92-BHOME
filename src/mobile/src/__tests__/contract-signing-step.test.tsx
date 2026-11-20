// @vitest-environment jsdom
import React from 'react';
vi.mock('../features/contracts/ContractLoading', () => ({
  ContractLoading: ({ label }: { label: string }) => (
    <div role="progressbar" aria-label={label}>
      {label}
    </div>
  ),
}));
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  contractClient,
  type ContractRequest,
  type ContractView,
} from '../../../../packages/client-core/src/contracts';
import { ContractSigningStep } from '../features/contracts/ContractSigningStep';
import { ContractNotice } from '../features/contracts/ContractNotice';

vi.mock('react-native-paper', () => ({
  Text: ({
    children,
    accessibilityRole,
  }: {
    children: React.ReactNode;
    accessibilityRole?: React.AriaRole;
  }) => <span role={accessibilityRole}>{children}</span>,
}));

it('shows a readable connection message without request diagnostics', () => {
  render(
    <ContractNotice message="Không kết nối được máy chủ. Kết quả thao tác chưa được xác nhận. Hãy tải lại trước khi thử lại. · GET /api/v1/contracts/123/internal-signing" />,
  );
  expect(screen.getByRole('alert').textContent).toBe(
    'Không kết nối được máy chủ. Kết quả thao tác chưa được xác nhận. Hãy tải lại trước khi thử lại.',
  );
});
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
}));
vi.mock('../components/WorkspaceKit', () => ({
  ui: {},
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Heading: ({ title }: { title: string }) => <h2>{title}</h2>,
  Action: ({
    children,
    disabled,
    onPress,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock('../features/contracts/ContractSigningPanel', () => ({
  ContractSigningPanel: () => <span>Real signing panel</span>,
}));
vi.mock('../features/contracts/ContractActionForm', () => ({
  ContractActionForm: () => null,
  SigningCertificates: () => null,
}));
vi.mock('../features/contracts/SigningSetup', () => ({
  SignaturePlacementField: () => <span>PDF preview</span>,
}));
vi.mock('../features/contracts/ContractEvidence', () => ({ ContractEvidence: () => null }));
afterEach(cleanup);

it('Staff invites Tenant before Owner signs without approval and retains the Staff-entered email', async () => {
  const c = {
    ...contract('Holding', true),
    status: 'Draft',
    approvedAt: null,
    representativeResidentId: tenant,
  };
  let submitted = false;
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/internal-signing'))
      return {
        invitations: submitted
          ? [{ id: 'pending', status: 'InvitationAcceptedByProvider', expiresAt: '2099-01-01' }]
          : [],
        tenantAcceptedAt: null,
        ownerAcceptedAt: null,
        canContinue: false,
      };
    if (path.endsWith('/signing-invitations')) {
      submitted = true;
      return { id: 'pending', status: 'InvitationAcceptedByProvider' };
    }
    if (path === `/api/v1/contracts/${c.id}`) return c;
    throw new Error('Unexpected request: ' + path + ' ' + init?.method);
  });
  render(
    <ContractSigningStep
      api={contractClient(request as unknown as Parameters<typeof contractClient>[0])}
      contract={c}
      actorId="staff"
      role="Staff"
      onChanged={() => {}}
    />,
  );
  const email = await screen.findByLabelText('Email người giữ chỗ');
  fireEvent.change(email, { target: { value: 'staff-entered@example.invalid' } });
  const submit = await screen.findByRole('button', { name: 'Gửi lời mời ký qua email' });
  await waitFor(() => expect(submit).toHaveProperty('disabled', false));
  fireEvent.click(submit);
  fireEvent.click(submit);
  await waitFor(() =>
    expect(request.mock.calls.filter(([p]) => p.endsWith('/signing-invitations'))).toHaveLength(1),
  );
  const call = request.mock.calls.find(([p]) => p.endsWith('/signing-invitations'))!;
  expect(JSON.parse(call[1]!.body as string).recipientEmail).toBe('staff-entered@example.invalid');
  expect(
    request.mock.calls.some(([p]) => p.endsWith('/holding-approval') || p.endsWith('/signing')),
  ).toBe(false);
});

const id = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const tenant = '33333333-3333-4333-8333-333333333333';
it.each([
  ['Holding', false],
  ['Holding', true],
  ['Main', false],
  ['Main', true],
] as const)(
  'keeps an editable email for an active %s invitation, correction=%s',
  async (kind, correctEmail) => {
    const c = {
      ...contract(kind, true),
      representativeResidentId: tenant,
      signatures:
        kind === 'Main'
          ? [{ signerUserId: owner, status: 'Signed', signedAt: '2026-11-18T09:48:00Z' }]
          : [],
    } as ContractView;
    const request = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(async (path) => {
      if (path.endsWith('/internal-signing'))
        return {
          invitations: [
            {
              id: 'same-invitation',
              status: 'InvitationAcceptedByProvider',
              expiresAt: '2099-01-01T00:00:00Z',
            },
          ],
          maskedEmail: 't***@example.invalid',
          tenantAcceptedAt: null,
          canContinue: false,
        };
      if (path.endsWith('/signing-invitations'))
        return {
          id: 'same-invitation',
          status: 'InvitationAcceptedByProvider',
          expiresAt: '2099-01-01T00:00:00Z',
          token: 'private-token',
        };
      if (path === `/api/v1/contracts/${id}`) return c;
      throw new Error(path);
    });
    render(
      <ContractSigningStep
        api={contractClient(request as ContractRequest)}
        contract={c}
        role="Staff"
        actorId="staff"
        onChanged={vi.fn()}
      />,
    );
    const button = await screen.findByRole('button', { name: 'Gửi lại email' });
    expect(screen.queryByLabelText('Email người giữ chỗ')).toBeNull();
    const email = screen.getByLabelText('Email nhận lời mời mới');
    if (correctEmail) fireEvent.change(email, { target: { value: 'corrected@example.invalid' } });
    expect(screen.getByText(/liên kết và mã OTP mới/)).toBeTruthy();
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() =>
      expect(request.mock.calls.filter(([p]) => p.endsWith('/signing-invitations'))).toHaveLength(
        1,
      ),
    );
    const call = request.mock.calls.find(([p]) => p.endsWith('/signing-invitations'))!;
    expect(JSON.parse(call[1]!.body as string)).toMatchObject({ resend: true });
    if (correctEmail)
      expect(JSON.parse(call[1]!.body as string)).toMatchObject({
        recipientEmail: 'corrected@example.invalid',
      });
    else expect(JSON.parse(call[1]!.body as string)).not.toHaveProperty('recipientEmail');
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Gửi lại sau 1 phút' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    expect(screen.queryByText('private-token')).toBeNull();
  },
);
it.each([
  ['Main', false],
  ['Main', true],
  ['Holding', false],
  ['Holding', true],
] as const)(
  '%s resend=%s: shows a duplicate database email error and preserves the editable address',
  async (kind, resend) => {
    const c = {
      ...contract(kind, true),
      representativeResidentId: tenant,
      occupants: [{ id: tenant, label: 'Long', representative: true }],
    };
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/internal-signing'))
        return {
          invitations: resend
            ? [{ id: 'pending', status: 'InvitationAcceptedByProvider', expiresAt: '2099-01-01' }]
            : [],
          canContinue: false,
        };
      if (path.endsWith('/signing-invitations'))
        throw { status: 409, code: 'signing_email_already_in_use' };
      if (path === `/api/v1/contracts/${id}`) return c;
      throw new Error(path);
    });
    render(
      <ContractSigningStep
        api={contractClient(request as ContractRequest)}
        contract={c}
        role="Staff"
        actorId="staff"
        onChanged={vi.fn()}
      />,
    );
    const email = await screen.findByLabelText(
      resend
        ? 'Email nhận lời mời mới'
        : kind === 'Holding'
          ? 'Email người giữ chỗ'
          : 'Email nhận lời mời · Long',
    );
    fireEvent.change(email, { target: { value: 'duplicate@example.invalid' } });
    fireEvent.click(
      screen.getByRole('button', { name: resend ? 'Gửi lại email' : 'Gửi lời mời ký qua email' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Email này đã được sử dụng');
    expect((email as HTMLInputElement).value).toBe('duplicate@example.invalid');
    const statusCalls = request.mock.calls.filter(([path]) =>
      path.endsWith('/internal-signing'),
    ).length;
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới trạng thái ký' }));
    await waitFor(() =>
      expect(
        request.mock.calls.filter(([path]) => path.endsWith('/internal-signing')).length,
      ).toBeGreaterThan(statusCalls),
    );
    expect(screen.getByRole('alert').textContent).toContain('Email này đã được sử dụng');
    expect(screen.queryByText(/Chưa xác định được kết quả gửi/)).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: resend ? 'Gửi lại email' : 'Gửi lời mời ký qua email',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    fireEvent.change(email, { target: { value: 'new@example.invalid' } });
    expect(screen.queryByRole('alert')).toBeNull();
  },
);
it.each(['sent', 'timeout', 'rejected'] as const)(
  'Holding email %s: distinguishes sending, delivery confirmation and actual failure',
  async (outcome) => {
    const c = { ...contract('Holding', true), representativeResidentId: tenant };
    let finish!: (value: unknown) => void;
    let fail!: (error: unknown) => void;
    let submitted = false;
    const result = new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/internal-signing'))
        return {
          invitations: submitted
            ? [{ id: 'invite', status: 'InvitationAcceptedByProvider', expiresAt: '2099-01-01' }]
            : [],
          canContinue: false,
        };
      if (path.endsWith('/signing-invitations')) return result;
      if (path === `/api/v1/contracts/${id}`) return c;
      throw new Error(path);
    });
    render(
      <ContractSigningStep
        api={contractClient(request as ContractRequest)}
        contract={c}
        role="Staff"
        actorId="staff"
        onChanged={vi.fn()}
        onContinue={vi.fn()}
      />,
    );
    fireEvent.change(await screen.findByLabelText('Email người giữ chỗ'), {
      target: { value: 'synthetic@example.invalid' },
    });
    expect(screen.queryByText('Bước 6 · Ký hợp đồng')).toBeNull();
    expect(screen.queryByText(/OTP và chữ ký vẽ/)).toBeNull();
    expect(screen.getByText('Làm mới trạng thái ký')).toBeTruthy();
    expect(screen.queryByText('Chi tiết ký')).toBeNull();
    expect(screen.queryByText('Tiếp tục thanh toán')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lời mời ký qua email' }));
    await waitFor(() =>
      expect(request.mock.calls.some(([path]) => path.endsWith('/signing-invitations'))).toBe(true),
    );
    expect(screen.getByText('Đang gửi email, vui lòng chờ…')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Chưa xác định/)).toBeNull();
    if (outcome === 'sent') {
      submitted = true;
      finish({
        id: 'invite',
        status: 'InvitationAcceptedByProvider',
        expiresAt: '2099-01-01',
        token: 'must-not-display',
      });
      await screen.findByText(/Đã gửi email · Chờ ký/);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByText('must-not-display')).toBeNull();
      expect(screen.queryByText('Đang gửi email, vui lòng chờ…')).toBeNull();
    } else if (outcome === 'timeout') {
      fail({ status: 0 });
      await screen.findByText(/Chưa xác định được kết quả gửi/);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(
        (screen.getByRole('button', { name: 'Gửi lời mời ký qua email' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    } else {
      fail({ status: 400, code: 'signing_contacts_required' });
      await screen.findByRole('alert');
      expect(screen.queryByText(/Chưa xác định/)).toBeNull();
      expect(
        (screen.getByRole('button', { name: 'Gửi lời mời ký qua email' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    }
  },
);
it('shows the Holding signing skeleton until server data arrives without displaying premature signing state', async () => {
  let completeLoad!: (value: ContractView) => void;
  const c = contract('Holding', true);
  const response = new Promise<ContractView>((resolve) => {
    completeLoad = resolve;
  });
  const request = vi.fn(async (path: string) => {
    if (path.endsWith('/internal-signing')) return { invitations: [], canContinue: false };
    if (path === `/api/v1/contracts/${id}`) return response;
    throw new Error(path);
  });
  render(
    <ContractSigningStep
      api={contractClient(request as ContractRequest)}
      contract={c}
      role="Staff"
      actorId="staff"
      onChanged={vi.fn()}
    />,
  );
  expect(screen.getByRole('progressbar', { name: 'Đang tải thông tin gửi ký…' })).toBeTruthy();
  expect(screen.queryByText('Tiến độ chữ ký')).toBeNull();
  completeLoad(c);
  await screen.findByText('Ký hợp đồng');
  expect(screen.queryByRole('progressbar')).toBeNull();
});
function contract(kind: string, internal: boolean, signed = false): ContractView {
  return {
    id,
    kind,
    status: signed ? 'PendingActivation' : 'PendingSigning',
    ownerSignerId: owner,
    tenantUserId: internal ? null : tenant,
    signingMode: internal ? 'INTERNAL_OTP_DRAWN' : '',
    snapshotHash: 'reviewed-hash',
    approvedAt: '2026-11-15T00:00:00Z',
    signatures: signed
      ? [owner, ...(internal ? [] : [tenant])].map((signerUserId, i) => ({
          id: String(i),
          signerUserId,
          status: 'Signed',
          signedAt: '2026-11-15T00:00:00Z',
          method: 'OTP',
        }))
      : [],
    occupants: [],
    isDevelopmentDemo: false,
  } as unknown as ContractView;
}

it.each([
  ['Holding', true],
  ['Main', true],
  ['Holding', false],
  ['Main', false],
] as const)(
  '%s, invitation=%s: only backend-confirmed signatures unlock existing payment navigation',
  async (kind, internal) => {
    let latest = contract(kind, internal);
    let complete = false;
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/internal-signing'))
        return {
          invitations: [],
          tenantAcceptedAt: complete ? '2026-11-15T00:00:00Z' : null,
          ownerAcceptedAt: complete ? '2026-11-15T00:00:00Z' : null,
          canContinue: complete,
        };
      if (path.endsWith('/signing-methods')) return { methods: ['OTP'], default: 'OTP' };
      if (path === `/api/v1/contracts/${id}`) return latest;
      throw new Error('Unexpected request: ' + path);
    });
    const next = vi.fn();
    const api = contractClient(request as unknown as Parameters<typeof contractClient>[0]);
    render(
      <ContractSigningStep
        api={api}
        contract={latest}
        actorId={owner}
        role="Owner"
        onChanged={() => {}}
        onContinue={next}
      />,
    );
    await waitFor(() => expect(request).toHaveBeenCalled());
    if (kind === 'Holding') {
      await screen.findByText('Làm mới trạng thái ký');
      expect(screen.queryByText('Chi tiết ký')).toBeNull();
      expect(screen.queryByText('Tiếp tục thanh toán')).toBeNull();
    } else
      expect((screen.getByText('Tiếp tục thanh toán') as HTMLButtonElement).disabled).toBe(true);
    latest = contract(kind, internal, true);
    complete = true;
    fireEvent.click(screen.getByText('Làm mới trạng thái ký'));
    await waitFor(() =>
      expect((screen.getByText('Tiếp tục thanh toán') as HTMLButtonElement).disabled).toBe(false),
    );
    const before = request.mock.calls.length;
    fireEvent.click(screen.getByText('Tiếp tục thanh toán'));
    await waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(request.mock.calls.length).toBeGreaterThan(before);
  },
);

it('restores completed signatures on reopen and refuses navigation when a fresh backend check fails', async () => {
  const c = contract('Main', true, true);
  let offline = false;
  const request = vi.fn(async (path: string) => {
    if (offline) throw new Error('Offline');
    if (path.endsWith('/internal-signing'))
      return {
        invitations: [],
        tenantAcceptedAt: '2026-11-15T00:00:00Z',
        ownerAcceptedAt: '2026-11-15T00:00:00Z',
        canContinue: true,
      };
    if (path.endsWith('/signing-methods')) return { methods: ['OTP'], default: 'OTP' };
    return c;
  });
  const next = vi.fn();
  render(
    <ContractSigningStep
      api={contractClient(request as unknown as Parameters<typeof contractClient>[0])}
      contract={c}
      actorId={owner}
      role="Owner"
      onChanged={() => {}}
      onContinue={next}
    />,
  );
  await waitFor(() =>
    expect((screen.getByText('Tiếp tục thanh toán') as HTMLButtonElement).disabled).toBe(false),
  );
  offline = true;
  fireEvent.click(screen.getByText('Tiếp tục thanh toán'));
  await waitFor(() =>
    expect((screen.getByText('Tiếp tục thanh toán') as HTMLButtonElement).disabled).toBe(true),
  );
  expect(next).not.toHaveBeenCalled();
});
