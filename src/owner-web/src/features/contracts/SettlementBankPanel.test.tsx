import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import {
  contractClient,
  type ContractRequest,
  type SettlementReceivables,
} from '../../../../../packages/client-core/src/contracts';
import { SettlementBankPanel } from './SettlementBankPanel';
vi.mock('../payments/RefundPanel', () => ({ RefundPanel: () => <div>Refund workflow</div> }));
vi.mock('../payments/ReceiptExcessPanel', () => ({
  ReceiptExcessPanel: () => <div>Whole receipt excess workflow</div>,
}));
vi.mock('../payments/ExternalPaymentPayerPanel', () => ({
  ExternalPaymentPayerPanel: () => <div>External payer verification</div>,
}));
const data = {
  contractId: 'contract',
  reference: 'source-1',
  payers: [
    { userId: 'representative', displayLabel: 'Synthetic representative' },
    { userId: 'co-tenant', displayLabel: 'Synthetic actual payer' },
  ],
  receivables: [
    {
      charge: { id: 'charge', description: 'Synthetic repair' },
      outstanding: '150000',
      status: 'PartiallyPaid',
    },
  ],
  offsets: [],
} as unknown as SettlementReceivables;
function mount() {
  const request = vi.fn<ContractRequest>(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (init?.method === 'POST')
        return {
          transferId: 'receipt',
          status: 'Allocated',
          allocatedAmount: '50000',
          unallocatedAmount: '0',
        } as T;
      if (path.includes('transfer-instructions'))
        return { transferReference: 'SERVER-REFERENCE' } as T;
      return {
        items: path.includes('PendingReview')
          ? [
              {
                id: 'receipt',
                bankReference: 'SYN-BANK',
                amount: '50000',
                transferDescription: 'SERVER-REFERENCE',
              },
            ]
          : [],
        totalCount: 1,
      } as T;
    },
  );
  const api = contractClient(
    <T,>(path: string, init?: RequestInit) => request(path, init) as Promise<T>,
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const saved = vi.fn(async () => {});
  const ui = (value: SettlementReceivables) => (
    <QueryClientProvider client={client}>
      <SettlementBankPanel api={api} data={value} saved={saved} />
    </QueryClientProvider>
  );
  const rendered = render(ui(data));
  return {
    request,
    saved,
    rerender: (value: SettlementReceivables) => rendered.rerender(ui(value)),
  };
}
async function fill() {
  fireEvent.mouseDown(screen.getByLabelText('Khoản phải thu nhận tiền'));
  fireEvent.click(await screen.findByRole('option', { name: /Synthetic repair/ }));
  fireEvent.mouseDown(screen.getByLabelText('Tiền ngân hàng đã xác minh'));
  fireEvent.click(await screen.findByRole('option', { name: /SYN-BANK/ }));
  fireEvent.mouseDown(screen.getByLabelText('Người thực chuyển tiền'));
  fireEvent.click(await screen.findByRole('option', { name: 'Synthetic actual payer' }));
}
const consent = 'Tôi đã kiểm tra giao dịch thực nhận, khoản đích và người thực trả trên sao kê';
it('submits the selected actual payer and uses the backend allocation result', async () => {
  const { request, saved } = mount();
  await fill();
  const confirm = screen.getByRole('button', { name: 'Xác nhận phân bổ tiền ngân hàng' });
  expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByLabelText(consent));
  fireEvent.click(confirm);
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const post = request.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(post[0]).toMatch(/charge\/bank-allocations$/);
  expect(JSON.parse(post[1]?.body as string)).toEqual({
    expectedReference: 'source-1',
    transferId: 'receipt',
    paidByUserId: 'co-tenant',
    humanConfirmed: true,
  });
  expect(screen.getByText(/Đã phân bổ 50.000/)).toBeTruthy();
});
it('requires renewed confirmation when the financial source changes', async () => {
  const { request, rerender } = mount();
  await fill();
  fireEvent.click(screen.getByLabelText(consent));
  expect(screen.getByRole('button', { name: 'Xác nhận phân bổ tiền ngân hàng' })).toBeEnabled();
  rerender({ ...data, reference: 'source-2' });
  expect(screen.getByRole('button', { name: 'Xác nhận phân bổ tiền ngân hàng' })).toBeDisabled();
  expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
