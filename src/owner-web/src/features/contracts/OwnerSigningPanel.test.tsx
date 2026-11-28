import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import {
  contractActions,
  contractClient,
  type ContractView,
} from '../../../../../packages/client-core/src/contracts';
import { OwnerSigningPanel } from './components/signing/OwnerSigningPanel';

const owner = '00000000-0000-0000-0000-000000000001',
  tenant = '00000000-0000-0000-0000-000000000002',
  id = '00000000-0000-0000-0000-000000000003',
  signatureId = '00000000-0000-0000-0000-000000000004';
const pending: ContractView = {
  id,
  roomId: id,
  locationId: id,
  kind: 'Main',
  status: 'PendingSigning',
  startDate: '2026-11-10',
  endDate: '2027-11-10',
  monthlyRent: '3000000',
  requiredDeposit: '3000000',
  terms: 'Điều khoản kiểm thử',
  previousContractId: null,
  residentIds: [id],
  signatures: [],
  activatedAt: null,
  ownerSignerId: owner,
  tenantUserId: tenant,
  representativeResidentId: id,
  holdingContractId: null,
  appliedHoldingDeposit: '0',
};
const methods = { methods: ['OWNER_SESSION', 'OTP'], default: 'OWNER_SESSION' };
const problem = (code: string) =>
  Object.assign(new Error(code), { name: 'ApiError', status: 422, problem: { code } });

vi.mock('./components/signing/SignaturePlacementPicker', () => ({
  SignaturePlacementPicker: () => <div>Reviewed PDF</div>,
}));

function renderPanel(
  contract: ContractView,
  transport: ReturnType<typeof vi.fn>,
  offered = methods,
) {
  const onChanged = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <OwnerSigningPanel
        api={contractClient(transport as unknown as Parameters<typeof contractClient>[0])}
        contract={contract}
        actorId={owner}
        methods={offered}
        onChanged={onChanged}
      />
    </QueryClientProvider>,
  );
  return onChanged;
}

it.each(['Holding', 'Main'])(
  'replaces a pending Owner OTP on %s with explicit session consent',
  async (kind) => {
    const transport = vi
      .fn()
      .mockResolvedValue({ id: signatureId, status: 'Signed', method: 'OWNER_SESSION' });
    const changed = renderPanel(
      {
        ...pending,
        kind,
        signatures: [
          {
            id: signatureId,
            signerUserId: owner,
            status: 'Pending',
            signedAt: null,
            method: 'OTP',
          },
        ],
      },
      transport,
      { methods: ['OWNER_SESSION', 'UPLOAD_PROOF'], default: 'OWNER_SESSION' },
    );
    const button = screen.getByRole('button', { name: 'Ký hợp đồng' });
    expect(button).toBeDisabled();
    expect(screen.queryByLabelText('Mã xác nhận')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(button).toBeDisabled();
    expect(transport).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Ảnh chữ ký cho hợp đồng'), {
      target: { files: [new File(['synthetic'], 'signature.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    const [path, init] = transport.mock.calls.at(-1)!;
    expect(path).toBe(`/api/v1/contracts/${id}/signing`);
    expect(JSON.parse(init.body)).toMatchObject({ method: 'OWNER_SESSION', consent: true });
    expect(transport.mock.calls.some(([url]) => url.includes('/otp'))).toBe(false);
  },
);

it('does not expose remote or PDF upload signing even when a stale server advertises them', () => {
  const transport = vi.fn();
  renderPanel(pending, transport, {
    methods: ['UPLOAD_PROOF', 'VIETTEL_MYSIGN'],
    default: 'UPLOAD_PROOF',
  });
  expect(screen.queryByRole('button', { name: /Bắt đầu ký|Gửi bản đã ký|Ký hợp đồng/ })).toBeNull();
  expect(screen.queryByTestId('signed-pdf-input')).toBeNull();
  expect(transport).not.toHaveBeenCalled();
});

it('does not reopen an old pending upload signature or send a new request', () => {
  const transport = vi.fn();
  const contract = {
    ...pending,
    signatures: [
      {
        id: signatureId,
        signerUserId: owner,
        status: 'Requested',
        signedAt: null,
        method: 'UPLOAD_PROOF',
      },
    ],
  } as ContractView;
  renderPanel(contract, transport);
  expect(screen.queryByRole('button', { name: /Gửi bản đã ký|Ký hợp đồng/ })).toBeNull();
  expect(screen.queryByTestId('signed-pdf-input')).toBeNull();
  expect(transport).not.toHaveBeenCalled();
});

it('keeps signing incomplete after a failed session request and preserves the retry key', async () => {
  const transport = vi.fn().mockImplementation((path: string) => {
    if (path.endsWith('/signing')) return Promise.reject(problem('owner_session_signing_failed'));
    return Promise.resolve({});
  });
  const changed = renderPanel(pending, transport);
  const button = screen.getByRole('button', { name: 'Ký hợp đồng' });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Ảnh chữ ký cho hợp đồng'), {
    target: { files: [new File(['synthetic'], 'signature.png', { type: 'image/png' })] },
  });
  fireEvent.click(button);
  await screen.findByText('Chưa ký được PDF. Hãy tải lại hợp đồng rồi thử lại.');
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() =>
    expect(transport.mock.calls.filter(([path]) => path.endsWith('/signing'))).toHaveLength(2),
  );
  const starts = transport.mock.calls.filter(([path]) => path.endsWith('/signing'));
  expect(starts[0][1].headers['Idempotency-Key']).toBeTruthy();
  expect(starts[0][1].headers['Idempotency-Key']).toBe(starts[1][1].headers['Idempotency-Key']);
  expect(changed).not.toHaveBeenCalled();
});

it('shows nothing for the tenant, a signed owner, or a demo contract', () => {
  const transport = vi.fn();
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <OwnerSigningPanel
        api={contractClient(transport)}
        contract={pending}
        actorId={tenant}
        methods={methods}
        onChanged={vi.fn()}
      />
      <OwnerSigningPanel
        api={contractClient(transport)}
        contract={{
          ...pending,
          signatures: [{ id: signatureId, signerUserId: owner, status: 'Signed', signedAt: null }],
        }}
        actorId={owner}
        methods={methods}
        onChanged={vi.fn()}
      />
      <OwnerSigningPanel
        api={contractClient(transport)}
        contract={{ ...pending, isDevelopmentDemo: true }}
        actorId={owner}
        methods={methods}
        onChanged={vi.fn()}
      />
    </QueryClientProvider>,
  );
  expect(container.textContent).toBe('');
  expect(transport).not.toHaveBeenCalled();
});

it('only offers the generic signing action for demo, never remote MySign', () => {
  const remote = (m?: string[]) =>
    contractActions(pending, null, 'Owner', owner, m).some((a) => a.operation === 'signing');
  expect(remote(['UPLOAD_PROOF', 'OTP'])).toBe(false);
  expect(remote(undefined)).toBe(false);
  expect(remote(['UPLOAD_PROOF', 'VIETTEL_MYSIGN'])).toBe(false);
  expect(
    contractActions({ ...pending, isDevelopmentDemo: true }, null, 'Owner', owner, [
      'SIMULATED',
    ]).some((a) => a.operation === 'signing'),
  ).toBe(true);
});
