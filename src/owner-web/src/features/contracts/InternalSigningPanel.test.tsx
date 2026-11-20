import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import {
  contractClient,
  type ContractRequest,
  type ContractView,
} from '../../../../../packages/client-core/src/contracts';
import { InternalSigningPanel } from './InternalSigningPanel';
vi.mock('./SignaturePlacementPicker', () => ({
  SignaturePlacementPicker: () => <div>PDF thực từ API ký</div>,
}));
afterEach(cleanup);

it.each(['Holding', 'Main'])(
  'real %s signs with Owner session in its required order',
  async (kind) => {
    const c = {
      ...contract,
      id: '11111111-1111-4111-8111-111111111111',
      kind,
      isDevelopmentDemo: false,
      ownerSignerId: '22222222-2222-4222-8222-222222222222',
      tenantUserId: null,
      signatures: [],
    } as ContractView;
    const changed = vi.fn();
    const request = vi.fn(async (path: string, _init?: RequestInit) => {
      void _init; // Retain the request argument in the mock call tuple for assertions below.
      if (path.endsWith('/internal-signing'))
        return {
          invitations: [],
          tenantAcceptedAt: null,
          ownerAcceptedAt: null,
          canContinue: false,
        };
      if (path.endsWith('/signing-methods'))
        return { methods: ['OWNER_SESSION'], default: 'OWNER_SESSION' };
      if (path.endsWith('/signature-image')) return { present: true };
      if (path.endsWith('/signing')) return { id: 'signature', status: 'Signed' };
      if (path.endsWith(c.id)) return c;
      throw new Error(path);
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <InternalSigningPanel
          api={contractClient(request as ContractRequest)}
          contract={c}
          onChanged={changed}
        />
      </QueryClientProvider>,
    );
    const button = await screen.findByRole('button', { name: 'Ký hợp đồng' });
    if (kind === 'Holding') {
      expect(screen.queryByRole('button', { name: 'Gửi lời mời ký qua email' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Phê duyệt hợp đồng giữ chỗ' })).toBeNull();
    }
    expect(screen.queryByLabelText(/Email nhận lời mời/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Xem PDF hợp đồng' })).toBeEnabled();
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Ảnh chữ ký cho hợp đồng'), {
      target: { files: [new File(['synthetic'], 'signature.png', { type: 'image/png' })] },
    });
    fireEvent.click(button);
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    const start = request.mock.calls.find(([path]) => path.endsWith('/signing'));
    expect(start).toBeTruthy();
    expect(JSON.parse(start![1]!.body as string)).toMatchObject({
      method: 'OWNER_SESSION',
      consent: true,
    });
    expect(request.mock.calls.some(([path]) => path.includes('/signing/otp'))).toBe(false);
    expect(request.mock.calls.some(([path]) => path.endsWith('/owner-confirmation'))).toBe(false);
  },
);
const contract = {
  id: 'holding',
  kind: 'Holding',
  status: 'PendingSigning',
  approvedAt: '2026-11-13T00:00:00Z',
  snapshotHash: 'snapshot',
  isDevelopmentDemo: true,
} as ContractView;
function show(sandboxAvailable = true, reject = false, kind = 'Holding', hasInvitation = false) {
  let confirmed = false;
  const request = vi.fn(async (path: string) => {
    if (path.endsWith('/owner-confirmation')) {
      if (reject) throw { status: 403 };
      confirmed = true;
      return;
    }
    return {
      invitations: hasInvitation
        ? [{ id: 'invite', status: 'InvitationAcceptedByProvider', expiresAt: '2099-01-01' }]
        : [],
      tenantAcceptedAt: null,
      ownerAcceptedAt: confirmed ? '2026-11-13T01:00:00Z' : null,
      documentHash: kind === 'Holding' ? 'outdated-before-approval' : 'snapshot',
      sandboxAvailable,
      canContinue: false,
    };
  });
  const changed = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <InternalSigningPanel
        api={contractClient(request as ContractRequest)}
        contract={{ ...contract, kind }}
        onChanged={changed}
      />
    </QueryClientProvider>,
  );
  return { request, changed };
}
it('shows a real Main invitation to the notified Owner instead of offering sandbox confirmation', async () => {
  show(true, false, 'Main', true);
  expect(await screen.findByText(/Chờ người đại diện thuê mở email và ký/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Owner xác nhận ký (Sandbox)' })).toBeNull();
});
it('lets the Owner confirm Main Sandbox without selecting an account or requiring Tenant OTP', async () => {
  const { request, changed } = show(true, false, 'Main');
  const button = await screen.findByRole('button', { name: 'Owner xác nhận ký (Sandbox)' });
  expect(button).toBeDisabled();
  expect(screen.queryByRole('combobox')).toBeNull();
  fireEvent.click(screen.getByLabelText('Tôi là Owner, đã xem nội dung và xác nhận ký test'));
  fireEvent.click(button);
  await screen.findByText(/Owner đã xác nhận test/);
  expect(changed).toHaveBeenCalledOnce();
  expect(request.mock.calls.filter(([path]) => path.endsWith('/owner-confirmation'))).toHaveLength(
    1,
  );
  expect(screen.queryByText('Ký nội bộ qua OTP')).toBeNull();
});
it('requires explicit Owner checkbox and persists confirmation before Tenant simulation without declaring QR ready', async () => {
  const { request, changed } = show();
  const button = await screen.findByRole('button', { name: 'Xác nhận chữ ký Owner (Sandbox)' });
  expect(button).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText(
      'Tôi là Owner, đồng ý nội dung và xác nhận chữ ký giả lập cho hợp đồng này',
    ),
  );
  fireEvent.click(button);
  await screen.findByText(/Owner đã xác nhận:/);
  expect(request).toHaveBeenCalledWith(
    '/api/v1/contracts/holding/internal-signing/owner-confirmation',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        documentHash: 'snapshot',
        consent: true,
        consentVersion: 'internal-acceptance-v1',
      }),
    }),
  );
  expect(changed).toHaveBeenCalledOnce();
  expect(
    screen.getByText('Chỉ khi đủ xác nhận của Owner và Tenant, backend mới cho sang bước QR.'),
  ).toBeInTheDocument();
});
it('does not show Sandbox confirmation when backend capability is disabled', async () => {
  const { request } = show(false);
  await waitFor(() => expect(request).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Xác nhận chữ ký Owner (Sandbox)' })).toBeNull();
});
it('retains unconfirmed state when backend rejects the Owner action', async () => {
  show(true, true);
  const button = await screen.findByRole('button', { name: 'Xác nhận chữ ký Owner (Sandbox)' });
  fireEvent.click(
    screen.getByLabelText(
      'Tôi là Owner, đồng ý nội dung và xác nhận chữ ký giả lập cho hợp đồng này',
    ),
  );
  fireEvent.click(button);
  await screen.findByText('Chưa thể hoàn tất. Vui lòng kiểm tra kết nối và thử lại.');
  await waitFor(() => expect(button).toBeEnabled());
  expect(screen.queryByText(/Owner đã xác nhận:/)).toBeNull();
});
