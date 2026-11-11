import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ContractView } from '../../../../../packages/client-core/src/contracts';
import { DepositReceiptPanel } from './DepositReceiptPanel';
const api = vi.hoisted(() => ({
  transfers: vi.fn(),
  transfer: vi.fn(),
  depositContext: vi.fn(),
  allocateDeposit: vi.fn(),
  depositPosition: vi.fn(),
}));
vi.mock('../payments/usePaymentApi', () => ({ usePaymentApi: () => api }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
vi.mock('../payments/ExternalPaymentPayerPanel', () => ({
  ExternalPaymentPayerPanel: () => <div>External payer verification</div>,
}));
vi.mock('../payments/RefundPanel', () => ({
  RefundPanel: ({ sourceId }: { sourceId: string }) => (
    <div>Actual refund workflow: {sourceId}</div>
  ),
}));
vi.mock('../payments/OwnerInvoicePaymentPanel', () => ({
  RecordTransferForm: () => <div>Bank receipt recording</div>,
}));
const receipt = {
  id: 'receipt',
  bankReference: 'SYN-BANK',
  amount: '80000',
  status: 'PendingReview',
  transferDescription: 'BHOME-DEPOSIT',
  allocatedAmount: '0',
  unallocatedAmount: '80000',
};
const context = {
  transferId: 'receipt',
  contractId: 'contract',
  reference: 'DEPOSIT-SOURCE',
  depositReference: 'BHOME-DEPOSIT',
  required: '100000',
  received: '60000',
  remaining: '40000',
  proposedAllocation: '40000',
  excess: '40000',
  payers: [{ residentId: 'actual-resident', userId: null, label: 'Synthetic actual payer' }],
  externalPayer: null,
  problems: [],
  isDevelopmentDemo: false,
};
let cache: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.transfers.mockResolvedValue({ items: [receipt], totalCount: 1, page: 1, pageSize: 20 });
  api.transfer.mockResolvedValue(receipt);
  api.depositContext.mockResolvedValue(context);
  api.depositPosition.mockResolvedValue({
    contractId: 'contract',
    transferReference: 'BHOME-DEPOSIT',
    required: '100000',
    received: '60000',
    remaining: '40000',
    isDevelopmentDemo: false,
  });
});
afterEach(() => {
  cleanup();
  cache.clear();
});
function mount() {
  render(
    <QueryClientProvider client={cache}>
      <DepositReceiptPanel
        contract={{ id: 'contract', kind: 'Main' } as ContractView}
        changed={vi.fn()}
      />
    </QueryClientProvider>,
  );
}
async function select(label: string, option: RegExp) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
it('selects a pre-account actual payer and retries with the same key before showing the real refund workflow', async () => {
  api.allocateDeposit.mockRejectedValueOnce({ status: 503 }).mockImplementationOnce(async () => {
    api.transfer.mockResolvedValue({
      ...receipt,
      status: 'Allocated',
      allocatedDepositContractId: 'contract',
      allocatedAmount: '40000',
      unallocatedAmount: '40000',
    });
    return { status: 'Allocated', reason: 'verified_deposit_excess_refund_required' };
  });
  mount();
  await screen.findByText(/Chọn receipt đã đối chiếu/);
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Receipt cọc trên sao kê' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    ),
  );
  await select('Receipt cọc trên sao kê', /SYN-BANK/);
  await screen.findByText(/Phần dư phải hoàn/);
  expect(screen.queryByRole('textbox', { name: /Mã giao dịch/ })).not.toBeInTheDocument();
  await select('Người thực trả cọc', /Synthetic actual payer.*Chưa có tài khoản/);
  const submit = screen.getByRole('button', { name: 'Phân bổ receipt vào cọc' });
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /Tôi xác nhận đúng receipt/ }));
  fireEvent.click(submit);
  await waitFor(() => expect(api.allocateDeposit).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
  await screen.findByText('Actual refund workflow: receipt');
  expect(api.allocateDeposit.mock.calls[0]).toEqual(api.allocateDeposit.mock.calls[1]);
  expect(api.allocateDeposit.mock.calls[0][1]).toEqual({
    contractId: 'contract',
    paidByUserId: null,
    paidByResidentId: 'actual-resident',
    expectedReference: 'DEPOSIT-SOURCE',
    humanVerified: true,
  });
  expect(api.transfers).toHaveBeenCalledWith(
    expect.objectContaining({ paymentStatus: 'Allocated', depositContractId: 'contract' }),
    expect.anything(),
  );
});
it('sends an external attestation instead of a fabricated Resident and blocks stale contexts', async () => {
  api.depositContext.mockResolvedValue({
    ...context,
    payers: [],
    externalPayer: { id: 'external', payerLabel: 'Synthetic outside' },
  });
  api.allocateDeposit.mockRejectedValue({ status: 409, code: 'deposit_context_changed' });
  mount();
  await waitFor(() => expect(api.transfers).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Receipt cọc trên sao kê' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    ),
  );
  await select('Receipt cọc trên sao kê', /SYN-BANK/);
  await screen.findByText(/Phần dư phải hoàn/);
  await select('Người thực trả cọc', /Synthetic outside/);
  fireEvent.click(screen.getByRole('checkbox', { name: /Tôi xác nhận đúng receipt/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Phân bổ receipt vào cọc' }));
  await screen.findByText(/Nguồn hoặc số cọc đã đổi/);
  expect(api.allocateDeposit.mock.calls[0][1]).toEqual({
    contractId: 'contract',
    paidByUserId: null,
    externalPayerAttestationId: 'external',
    expectedReference: 'DEPOSIT-SOURCE',
    humanVerified: true,
  });
  api.depositContext.mockResolvedValue({
    ...context,
    reference: 'CHANGED',
    problems: ['deposit_already_satisfied'],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại đối chiếu cọc' }));
  await screen.findByText(/Cọc đã đủ/);
  expect(screen.getByRole('button', { name: 'Phân bổ receipt vào cọc' })).toBeDisabled();
});
