import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import {
  contractActions,
  contractClient,
  type ContractView,
} from '../../../../../packages/client-core/src/contracts';
import { OwnerSigningPanel } from './OwnerSigningPanel';

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
const methods = { methods: ['UPLOAD_PROOF', 'OTP'], default: 'UPLOAD_PROOF' };
const problem = (code: string) =>
  Object.assign(new Error(code), { name: 'ApiError', status: 422, problem: { code } });

vi.mock('./SignaturePlacementPicker', () => ({
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

it('starts UPLOAD_PROOF signing with an idempotency key and no certificate', async () => {
  const transport = vi.fn().mockResolvedValue({ id: signatureId });
  const onChanged = renderPanel(pending, transport);
  expect(screen.getByRole('button', { name: /Tải về & ký số bên ngoài/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu ký' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  const [path, init] = transport.mock.calls[0];
  expect(path).toBe(`/api/v1/contracts/${id}/signing`);
  expect(init.method).toBe('POST');
  expect(init.headers['Idempotency-Key']).toBeTruthy();
  expect(JSON.parse(init.body)).toMatchObject({ method: 'UPLOAD_PROOF' });
});

it('uploads the signed PDF and marks the failed check when BHOME refuses it', async () => {
  const contract = {
    ...pending,
    signatures: [
      {
        id: signatureId,
        signerUserId: owner,
        status: 'Requested',
        signedAt: null,
        method: 'UPLOAD_PROOF',
        expiresAt: '2026-11-12T09:00:00Z',
      },
    ],
  } as ContractView;
  const transport = vi
    .fn()
    .mockRejectedValueOnce(problem('signed_pdf_certificate_issuer_not_allowed'));
  const onChanged = renderPanel(contract, transport);
  expect(screen.getByRole('button', { name: 'Gửi bản đã ký' })).toHaveProperty('disabled', true);
  const pdf = new File(['%PDF-1.7'], 'hop-dong-da-ky.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByTestId('signed-pdf-input'), { target: { files: [pdf] } });
  await screen.findByText(/hop-dong-da-ky\.pdf/);
  fireEvent.click(screen.getByRole('button', { name: 'Gửi bản đã ký' }));
  await screen.findByText('Chứng thư không do Viettel-CA cấp.');
  expect(screen.getByText(/✕ Tên bên cấp chứng thư khớp cấu hình/)).toBeTruthy();
  expect(screen.getByText(/✓ Đúng bản hợp đồng đã phát/)).toBeTruthy();
  const [path, init] = transport.mock.calls[0];
  expect(path).toBe(`/api/v1/contracts/${id}/signing/upload`);
  expect(init.method).toBe('PUT');
  expect(init.headers['Content-Type']).toBe('application/pdf');
  expect(init.body).toBe(pdf);
  expect(onChanged).not.toHaveBeenCalled();
});

it('rejects a non-PDF file before sending anything', async () => {
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
  const transport = vi.fn();
  renderPanel(contract, transport);
  const png = new File(['x'], 'anh.png', { type: 'image/png' });
  fireEvent.change(screen.getByTestId('signed-pdf-input'), { target: { files: [png] } });
  await screen.findByText('Chỉ nhận file PDF.');
  expect(transport).not.toHaveBeenCalled();
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
    </QueryClientProvider>,
  );
  expect(container.textContent).toBe('');
});

it('offers the remote MySign action only when the server still offers VIETTEL_MYSIGN', () => {
  const draft = { ...pending, status: 'PendingSigning' };
  const remote = (m?: string[]) =>
    contractActions(draft, null, 'Owner', owner, m).some((a) => a.operation === 'signing');
  expect(remote(['UPLOAD_PROOF', 'OTP'])).toBe(false);
  expect(remote(undefined)).toBe(true);
  expect(remote(['UPLOAD_PROOF', 'VIETTEL_MYSIGN'])).toBe(true);
});
