import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReceiptExcessPanel } from './ReceiptExcessPanel';
const api = vi.hoisted(() => ({
  excessDisposition: vi.fn(),
  excessContext: vi.fn(),
  confirmExcess: vi.fn(),
}));
vi.mock('./usePaymentApi', () => ({ usePaymentApi: () => api }));
vi.mock('./RefundPanel', () => ({
  RefundPanel: ({ sourceId }: { sourceId: string }) => <div>Refund workflow {sourceId}</div>,
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
const target = { invoiceId: 'invoice' };
const context = {
  transferId: 'receipt',
  target,
  roomId: 'room',
  amount: '50000',
  outstanding: '0',
  transferReference: 'INV-REF',
  reference: 'EXCESS-1',
  problems: [],
  disposition: null,
  isDevelopmentDemo: true,
  payers: [{ residentId: 'resident', userId: null, label: 'Synthetic actual payer' }],
};
const disposition = {
  id: 'confirmed',
  transferId: 'receipt',
  target,
  amount: '50000',
  payerLabel: 'Synthetic actual payer',
};
let cache: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.excessDisposition.mockResolvedValue(null);
  api.excessContext.mockResolvedValue(context);
});
afterEach(() => {
  cleanup();
  cache.clear();
});
function mount(selectedTarget = target as { invoiceId?: string; depositContractId?: string }) {
  render(
    <QueryClientProvider client={cache}>
      <ReceiptExcessPanel transferId="receipt" target={selectedTarget} />
    </QueryClientProvider>,
  );
}
it('does not reuse a whole-excess decision for another Main deposit', async () => {
  api.excessDisposition.mockResolvedValue({
    ...disposition,
    target: { depositContractId: 'other-main' },
  });
  mount({ depositContractId: 'main' });
  await screen.findByText(/Giao dịch đã được xác nhận hoàn theo nghĩa vụ khác/);
  expect(screen.queryByText('Refund workflow receipt')).not.toBeInTheDocument();
  expect(api.confirmExcess).not.toHaveBeenCalled();
});
async function fill() {
  await screen.findByText('Xác nhận toàn bộ giao dịch là tiền dư');
  fireEvent.mouseDown(screen.getByLabelText('Người thực trả nhận lại tiền'));
  fireEvent.click(await screen.findByRole('option', { name: 'Synthetic actual payer' }));
  fireEvent.change(screen.getByLabelText('Lý do xác nhận toàn bộ tiền dư'), {
    target: { value: 'Synthetic statement reviewed' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
}
it('requires fresh human consent, preserves the operation key on retry and opens the refund workflow only after persistence', async () => {
  api.confirmExcess.mockRejectedValueOnce({ status: 503 }).mockImplementationOnce(async () => {
    api.excessDisposition.mockResolvedValue(disposition);
    return disposition;
  });
  mount();
  await fill();
  const submit = screen.getByRole('button', { name: 'Xác nhận nghĩa vụ hoàn toàn bộ giao dịch' });
  fireEvent.click(submit);
  await screen.findByRole('alert', { name: '' });
  await waitFor(() => expect(submit).toBeEnabled());
  expect(screen.queryByText('Refund workflow receipt')).not.toBeInTheDocument();
  fireEvent.click(submit);
  await screen.findByText('Refund workflow receipt');
  expect(api.confirmExcess).toHaveBeenCalledTimes(2);
  expect(api.confirmExcess.mock.calls[0][2]).toBe(api.confirmExcess.mock.calls[1][2]);
  expect(api.confirmExcess.mock.calls[1][1]).toEqual({
    target,
    expectedReference: 'EXCESS-1',
    payerResidentId: 'resident',
    reason: 'Synthetic statement reviewed',
    humanConfirmed: true,
  });
});
it('invalidates consent when backend context changes and blocks confirmation for an unsettled target', async () => {
  mount();
  await fill();
  cache.setQueryData(['receipt-excess-context', 'owner', 'receipt', target], {
    ...context,
    reference: 'EXCESS-2',
    outstanding: '100',
    problems: ['receipt_target_not_settled'],
  });
  await screen.findByText('Nghĩa vụ vẫn còn số tiền phải trả; cần đối soát phân bổ trước.');
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(
    screen.getByRole('button', { name: 'Xác nhận nghĩa vụ hoàn toàn bộ giao dịch' }),
  ).toBeDisabled();
  expect(api.confirmExcess).not.toHaveBeenCalled();
});
it('loads a durable disposition directly without offering a second confirmation', async () => {
  api.excessDisposition.mockResolvedValue(disposition);
  mount();
  await screen.findByText('Refund workflow receipt');
  expect(api.excessContext).not.toHaveBeenCalled();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
it('confirms whole excess to the attested outside payer without a placeholder Resident', async () => {
  api.excessContext.mockResolvedValue({
    ...context,
    payers: [],
    externalPayer: { id: 'outside', payerLabel: 'Synthetic outside payer' },
  });
  api.confirmExcess.mockRejectedValue({ status: 503 });
  mount();
  await screen.findByText('Xác nhận toàn bộ giao dịch là tiền dư');
  fireEvent.mouseDown(screen.getByLabelText('Người thực trả nhận lại tiền'));
  fireEvent.click(await screen.findByRole('option', { name: /Synthetic outside payer/ }));
  fireEvent.change(screen.getByLabelText('Lý do xác nhận toàn bộ tiền dư'), {
    target: { value: 'Synthetic checked source' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận nghĩa vụ hoàn toàn bộ giao dịch' }));
  await waitFor(() =>
    expect(api.confirmExcess).toHaveBeenCalledWith(
      'receipt',
      expect.objectContaining({ payerResidentId: null, externalPayerAttestationId: 'outside' }),
      expect.any(String),
    ),
  );
});
