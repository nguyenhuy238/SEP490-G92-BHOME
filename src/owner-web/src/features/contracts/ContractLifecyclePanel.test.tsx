import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import {
  contractClient,
  type ContractRequest,
  type ContractView,
  type MoveOut,
  type SettlementSummary,
} from '../../../../../packages/client-core/src/contracts';
import { useContractLifecycle } from '../../../../../packages/client-core/src/useContractLifecycle';
import { ContractLifecyclePanel } from './ContractLifecyclePanel';
vi.mock('../payments/RefundPanel', () => ({
  RefundPanel: ({ sourceId, sourceKind }: { sourceId: string; sourceKind: string }) => (
    <div data-testid="deposit-refund-source">
      {sourceKind}:{sourceId}
    </div>
  ),
}));

const id = '00000000-0000-0000-0000-000000000001';
const contract = { id, locationId: id } as ContractView;
const moveOut = { status: 'PendingSettlement', version: 4 } as MoveOut;
const summary: SettlementSummary = {
  contractId: id,
  depositContractId: id,
  roomNumber: 'TEST',
  verifiedSecurityDeposit: '3000000',
  appliedHoldingDeposit: '0',
  contractSpecificOutstanding: null,
  approvedFinalCharges: null,
  approvedDeductions: null,
  refundAmount: null,
  invoices: [
    {
      invoiceId: id,
      billingPeriod: '2026-11-01',
      shared: true,
      financials: {
        originalIssuedAmount: '100000',
        approvedAdjustmentTotal: '-10000',
        effectivePayableAmount: '90000',
        allocatedPayments: '0',
        outstandingAmount: '90000',
        potentialExcessAmount: '0',
      },
    },
  ],
  unresolvedItems: [
    'shared_liability_allocation_pending',
    'deposit_deduction_refund_policy_required',
  ],
  otherActiveContracts: true,
  resolved: false,
  reference: 'BH40-SYNTHETIC-REVIEW',
  transferVerificationStatus: 'PendingReview',
};
function setup() {
  const request = vi.fn<ContractRequest>(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (init?.method === 'POST') throw { status: 409, code: 'settlement_review_changed' };
      return (
        path.endsWith('/settlement-summary')
          ? summary
          : path.endsWith('/inspection-preparation')
            ? { baseline: null, finalReadings: [], otherTenantsRemain: true }
            : []
      ) as T;
    },
  );
  return {
    request,
    api: contractClient(
      <T,>(path: string, init?: RequestInit) => request(path, init) as Promise<T>,
    ),
  };
}
it('shows unallocated shared debt and unknown refund, submits the displayed fingerprint and retains a stale review error', async () => {
  const { api, request } = setup(),
    changed = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ContractLifecyclePanel api={api} contract={contract} moveOut={moveOut} onChanged={changed} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/Hóa đơn chung còn nợ/)).toBeVisible();
  expect(screen.getByText(/Hoàn tiền: Chờ xác minh/)).toBeVisible();
  expect(screen.getByText(/Điều chỉnh −10.000/)).toBeVisible();
  expect(screen.getByTestId('deposit-refund-source')).toHaveTextContent(`SecurityDeposit:${id}`);
  expect(screen.queryByText(/đủ điều kiện xem xét hoàn tất/)).toBeNull();
  fireEvent.change(screen.getByLabelText('Lý do / căn cứ của Owner'), {
    target: { value: 'Còn nghĩa vụ cần đối chiếu' },
  });
  fireEvent.click(screen.getByLabelText('Tôi đã đọc số liệu và các nghĩa vụ còn chờ xử lý'));
  fireEvent.click(screen.getByText('Lưu xem xét quyết toán'));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining('/move-out/settlement'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          decision: 'Còn nghĩa vụ cần đối chiếu',
          expectedReference: summary.reference,
        }),
      }),
    ),
  );
  expect(changed).not.toHaveBeenCalled();
  expect(await screen.findByRole('button', { name: 'Lưu xem xét quyết toán' })).toBeEnabled();
});
it('does not fetch financial settlement data for Staff or inspection preparation for Tenant', async () => {
  const { api, request } = setup();
  const hook = renderHook(({ role }) => useContractLifecycle(api, id, role), {
    initialProps: { role: 'Staff' },
  });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(request.mock.calls.some(([p]) => p.endsWith('/settlement-summary'))).toBe(false);
  request.mockClear();
  hook.rerender({ role: 'Tenant' });
  await waitFor(() =>
    expect(request.mock.calls.some(([p]) => p.endsWith('/settlement-summary'))).toBe(true),
  );
  expect(request.mock.calls.some(([p]) => p.endsWith('/inspection-preparation'))).toBe(false);
});
it('requires a new settlement consent when a refreshed financial snapshot changes', async () => {
  const { api } = setup();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ContractLifecyclePanel api={api} contract={contract} moveOut={moveOut} onChanged={vi.fn()} />
    </QueryClientProvider>,
  );
  const label = 'Tôi đã đọc số liệu và các nghĩa vụ còn chờ xử lý';
  await screen.findByLabelText(label);
  fireEvent.change(screen.getByLabelText('Lý do / căn cứ của Owner'), {
    target: { value: 'Reviewed old numbers' },
  });
  fireEvent.click(screen.getByLabelText(label));
  expect(screen.getByRole('button', { name: 'Lưu xem xét quyết toán' })).toBeEnabled();
  vi.spyOn(api, 'settlementSummary').mockResolvedValue({ ...summary, reference: 'BH40-CHANGED' });
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại dữ liệu quyết toán' }));
  await waitFor(() => expect(screen.getByLabelText(label)).not.toBeChecked());
  expect(screen.getByRole('button', { name: 'Lưu xem xét quyết toán' })).toBeDisabled();
});
it('invalidates the current Contract deposit source after a decision even within the app cache freshness window', async () => {
  const { api } = setup();
  vi.spyOn(api, 'mutate').mockResolvedValue({});
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 10000 } },
  });
  const key = ['refund-source', 'owner', 'SecurityDeposit', id];
  const other = ['refund-source', 'owner', 'SecurityDeposit', 'other-contract'];
  const receipt = ['refund-source', 'owner', 'Receipt', 'bank-receipt'];
  for (const k of [key, other, receipt])
    cache.setQueryData(k, { blockers: ['owner_confirmed_inspection_required'] });
  render(
    <QueryClientProvider client={cache}>
      <ContractLifecyclePanel api={api} contract={contract} moveOut={moveOut} onChanged={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByLabelText('Lý do / căn cứ của Owner');
  fireEvent.change(screen.getByLabelText('Lý do / căn cứ của Owner'), {
    target: { value: 'Decision changes deposit eligibility' },
  });
  fireEvent.click(screen.getByLabelText('Tôi đã đọc số liệu và các nghĩa vụ còn chờ xử lý'));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu xem xét quyết toán' }));
  await waitFor(() => expect(cache.getQueryState(key)?.isInvalidated).toBe(true));
  expect(cache.getQueryState(other)?.isInvalidated).toBe(false);
  expect(cache.getQueryState(receipt)?.isInvalidated).toBe(false);
});

it('clears stale data during reloads and contract changes, ignores aborted responses and handles errors', async () => {
  const { api } = setup();
  let resolveOld!: (value: SettlementSummary) => void;
  const old = new Promise<SettlementSummary>((resolve) => {
    resolveOld = resolve;
  });
  const nextId = '00000000-0000-0000-0000-000000000002';
  const financials = vi
    .spyOn(api, 'settlementSummary')
    .mockImplementationOnce(() => old)
    .mockResolvedValueOnce({ ...summary, contractId: nextId });
  const hook = renderHook(({ contractId }) => useContractLifecycle(api, contractId, 'Owner'), {
    initialProps: { contractId: id },
  });
  expect(hook.result.current.loading).toBe(true);
  hook.rerender({ contractId: nextId });
  expect(hook.result.current.loading).toBe(true);
  expect(hook.result.current.summary).toBeNull();
  await waitFor(() => expect(hook.result.current.summary?.contractId).toBe(nextId));
  expect(financials.mock.calls[0][1]?.aborted).toBe(true);
  await act(async () => {
    resolveOld(summary);
  });
  expect(hook.result.current.summary?.contractId).toBe(nextId);
  financials.mockRejectedValueOnce({ status: 503 });
  act(() => hook.result.current.reload());
  expect(hook.result.current.loading).toBe(true);
  expect(hook.result.current.summary).toBeNull();
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.error).not.toBe('');
  expect(hook.result.current.summary).toBeNull();
});

it('hides Owner financial data immediately when switching to Staff', async () => {
  const { api } = setup();
  const hook = renderHook(({ role }) => useContractLifecycle(api, id, role), {
    initialProps: { role: 'Owner' },
  });
  await waitFor(() => expect(hook.result.current.summary).toEqual(summary));
  hook.rerender({ role: 'Staff' });
  expect(hook.result.current.summary).toBeNull();
  expect(hook.result.current.loading).toBe(true);
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.summary).toBeNull();
});
