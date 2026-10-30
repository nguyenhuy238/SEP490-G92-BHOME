import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { expect, it, vi } from 'vitest';
import {
  contractActions,
  contractClient,
  mutationKeys,
  type ContractRequest,
  type ContractView,
  type MoveOut,
} from '../../../../../packages/client-core/src/contracts';
import { theme } from '../../theme/theme';
import { ContractDetailPanel } from './ContractDetailPanel';
import { ContractActionDialog } from './ContractActionDialog';
import { useContractDetail } from '../../../../../packages/client-core/src/useContractDetail';

const owner = '00000000-0000-0000-0000-000000000001',
  tenant = '00000000-0000-0000-0000-000000000002',
  id = '00000000-0000-0000-0000-000000000003';
const draft: ContractView = {
  id,
  roomId: id,
  locationId: id,
  kind: 'Main',
  status: 'PendingActivation',
  startDate: '2026-10-01',
  endDate: '2027-10-01',
  monthlyRent: '999999999999999999',
  requiredDeposit: '3000000',
  terms: 'Điều khoản tổng hợp kiểm thử',
  previousContractId: null,
  residentIds: [id],
  signatures: [
    { id: owner, signerUserId: owner, status: 'Signed', signedAt: '2026-10-30T02:00:00Z' },
    { id: tenant, signerUserId: tenant, status: 'Signed', signedAt: '2026-10-30T02:30:00Z' },
  ],
  activatedAt: null,
  ownerSignerId: owner,
  tenantUserId: tenant,
  representativeResidentId: id,
  holdingContractId: null,
  appliedHoldingDeposit: '0',
};
function mount(element: React.ReactNode) {
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={query}>{element}</QueryClientProvider>
    </ThemeProvider>,
  );
}
function setup(c = draft, ready = false, m: MoveOut | null = null) {
  const request = vi.fn<ContractRequest>();
  request.mockImplementation(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    let result: unknown;
    if (init?.method === 'POST') throw { status: 503 };
    if (path.endsWith('/activation-readiness'))
      result = {
        ready,
        verifiedDeposit: ready ? '3000000' : '1000000',
        remainingDeposit: ready ? '0' : '2000000',
        blockers: ready ? [] : ['security_deposit_insufficient'],
      };
    else if (path.endsWith('/move-out/settlement-history'))
      result = [
        {
          id,
          decision: 'Đã kiểm tra, còn chờ dữ liệu đối chiếu',
          settled: false,
          reviewedByUserId: owner,
          reviewedAt: '2026-10-30T03:00:00Z',
        },
      ];
    else if (path.endsWith('/move-out')) {
      if (!m) throw { status: 404 };
      result = m;
    } else result = c;
    return result as T;
  });
  return {
    request,
    api: contractClient(
      <T,>(path: string, init?: RequestInit, type?: 'json' | 'blob' | 'bytes') =>
        request(path, init, type) as Promise<T>,
    ),
  };
}
it('shows backend blockers and exact VND, and keeps activation disabled for insufficient verified deposit', async () => {
  const { api, request } = setup();
  mount(
    <ContractDetailPanel api={api} id={id} actorId={owner} locationId={id} onChanged={vi.fn()} />,
  );
  expect(await screen.findByText('Tiền cọc đã xác minh chưa đủ.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Kích hoạt hợp đồng' })).toBeDisabled();
  expect(screen.getByText('999.999.999.999.999.999 ₫')).toBeInTheDocument();
  expect(request.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
});
it('requires confirmation and sends one activation mutation only after the server reports readiness', async () => {
  const { api, request } = setup(draft, true);
  const changed = vi.fn();
  api.mutate = vi.fn().mockResolvedValue({ ...draft, status: 'Active' });
  mount(
    <ContractDetailPanel api={api} id={id} actorId={owner} locationId={id} onChanged={changed} />,
  );
  const activate = await screen.findByRole('button', { name: 'Kích hoạt hợp đồng' });
  expect(activate).toBeEnabled();
  fireEvent.click(activate);
  expect(api.mutate).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
  await waitFor(() => expect(api.mutate).toHaveBeenCalledTimes(1));
  expect(api.mutate).toHaveBeenCalledWith(
    id,
    'activate',
    undefined,
    expect.stringMatching(/^[0-9a-f-]{36}$/),
  );
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(request).toHaveBeenCalled();
});
it('validates deposit input and retains its idempotency key after network uncertainty, without reporting success', async () => {
  const { api } = setup();
  const mutation = vi.fn().mockRejectedValue({ status: 0 });
  api.mutate = mutation;
  const action = contractActions(draft, null, 'Owner', owner).find(
    (a) => a.operation === 'deposit-verifications',
  )!;
  const success = vi.fn();
  mount(
    <ContractActionDialog
      api={api}
      contract={draft}
      action={action}
      keys={mutationKeys(() => owner)}
      actorId={owner}
      onClose={vi.fn()}
      onSuccess={success}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  expect(await screen.findByText('Nội dung bắt buộc, tối đa 150 ký tự.')).toBeInTheDocument();
  expect(mutation).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Mã giao dịch trên sao kê'), {
    target: { value: 'SYNTHETIC-BANK-001' },
  });
  fireEvent.change(screen.getByLabelText('Số tiền cọc đã nhận (VND)'), {
    target: { value: '1000000.5' },
  });
  fireEvent.change(screen.getByLabelText('Căn cứ đối chiếu sao kê'), {
    target: { value: 'Sao kê tổng hợp kiểm thử' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  expect(
    await screen.findByText('Nhập số nguyên VND hợp lệ, tối đa 18 chữ số.'),
  ).toBeInTheDocument();
  expect(mutation).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Số tiền cọc đã nhận (VND)'), {
    target: { value: '1000000' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  await screen.findByText(/Kết quả thao tác chưa được xác nhận/);
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
  expect(mutation.mock.calls[0]).toEqual(mutation.mock.calls[1]);
  expect(success).not.toHaveBeenCalled();
});
it('keeps settlement pending with visible history and does not offer room release', async () => {
  const m: MoveOut = {
    id,
    status: 'PendingSettlement',
    proposedDate: '2026-10-30',
    reason: 'Lý do kiểm thử',
    inspectionScheduledAt: '2026-10-30T03:00:00Z',
    pendingReason: 'financial_ledger_and_deposit_policy',
    inspectionNotes: 'Hiện trạng kiểm thử',
    inspectedAt: '2026-10-30T03:00:00Z',
    electricityReadingId: owner,
    waterReadingId: tenant,
    evidenceIds: [],
  };
  const { api } = setup({ ...draft, status: 'Active' }, false, m);
  mount(
    <ContractDetailPanel api={api} id={id} actorId={owner} locationId={id} onChanged={vi.fn()} />,
  );
  expect(
    await screen.findByText(/Chờ đối chiếu nghĩa vụ, cọc và giao dịch thực tế/),
  ).toBeInTheDocument();
  expect(screen.getByText('Đã kiểm tra, còn chờ dữ liệu đối chiếu')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hoàn tất trả phòng' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Lưu biên bản trả phòng' })).not.toBeInTheDocument();
});
it('shows provider unavailability and never marks signing successful from a failed request', async () => {
  const c = { ...draft, status: 'Draft', signatures: [] };
  const { api } = setup(c);
  api.certificates = vi.fn().mockResolvedValue([
    {
      id,
      provider: 'MySign',
      serialNumber: 'SYNTHETIC',
      providerUserIdHint: '***001',
      locked: false,
      usable: true,
    },
  ]);
  const action = contractActions(c, null, 'Owner', owner).find((a) => a.operation === 'signing')!,
    success = vi.fn();
  mount(
    <ContractActionDialog
      api={api}
      contract={c}
      action={action}
      keys={mutationKeys(() => owner)}
      actorId={owner}
      onClose={vi.fn()}
      onSuccess={success}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-disabled', 'true'),
  );
  fireEvent.mouseDown(screen.getByRole('combobox'), { button: 0 });
  fireEvent.click(await screen.findByRole('option', { name: /MySign/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  expect(
    await screen.findByText(/Dịch vụ ký hoặc thành phần xử lý chưa sẵn sàng/),
  ).toBeInTheDocument();
  expect(success).not.toHaveBeenCalled();
});

it('never requests Owner/Tenant financial endpoints from a Staff detail view', async () => {
  const m: MoveOut = {
    id,
    status: 'Approved',
    proposedDate: '2026-10-30',
    reason: 'Tổng hợp kiểm thử',
    inspectionScheduledAt: null,
    pendingReason: '',
    inspectionNotes: null,
    inspectedAt: null,
    electricityReadingId: null,
    waterReadingId: null,
    evidenceIds: [],
  };
  const { api, request } = setup({ ...draft, status: 'Active' }, false, m);
  const { result } = renderHook(() => useContractDetail(api, id, 'Staff'));
  await waitFor(() => expect(result.current.data?.contract.id).toBe(id));
  expect(request.mock.calls.map(([path]) => path)).toEqual([
    `/api/v1/contracts/${id}`,
    `/api/v1/contracts/${id}/move-out`,
  ]);
  expect(result.current.data?.readiness).toBeNull();
  expect(result.current.data?.history).toEqual([]);
});

it('discards an aborted lookup when the user switches contract before its response arrives', async () => {
  const { api } = setup();
  let resolveFirst!: (value: ContractView) => void;
  const get = vi.fn().mockImplementation((lookupId: string) =>
    lookupId === id
      ? new Promise<ContractView>((resolve) => {
          resolveFirst = resolve;
        })
      : Promise.resolve({ ...draft, id: tenant }),
  );
  api.get = get;
  const { result, rerender } = renderHook(
    ({ lookupId }) => useContractDetail(api, lookupId, 'Owner'),
    { initialProps: { lookupId: id } },
  );
  rerender({ lookupId: tenant });
  await waitFor(() => expect(result.current.data?.contract.id).toBe(tenant));
  resolveFirst(draft);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.data?.contract.id).toBe(tenant);
  expect((get.mock.calls[0]![1] as AbortSignal).aborted).toBe(true);
});
