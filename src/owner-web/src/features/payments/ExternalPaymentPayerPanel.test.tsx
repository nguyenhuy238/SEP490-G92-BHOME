import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExternalPaymentPayerPanel } from './ExternalPaymentPayerPanel';
const api = vi.hoisted(() => ({ externalPayer: vi.fn(), confirmExternalPayer: vi.fn() }));
vi.mock('./usePaymentApi', () => ({ usePaymentApi: () => api }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
const context = {
  transferId: 'receipt',
  transferFingerprint: 'BANK-FP',
  statementReference: 'SYNTHETIC-STATEMENT',
  problems: [],
  payer: null,
  isDevelopmentDemo: true,
};
let cache: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.externalPayer.mockResolvedValue(context);
});
afterEach(() => {
  cleanup();
  cache.clear();
});
it('requires bank-statement consent, preserves retry keys and does not claim refund completion', async () => {
  api.confirmExternalPayer
    .mockRejectedValueOnce({ status: 503 })
    .mockImplementationOnce(async () => {
      api.externalPayer.mockResolvedValue({
        ...context,
        payer: { id: 'payer', payerLabel: 'SYNTHETIC OUTSIDE', verifiedAt: '2026-11-11T00:00:00Z' },
      });
    });
  render(
    <QueryClientProvider client={cache}>
      <ExternalPaymentPayerPanel transferId="receipt" />
    </QueryClientProvider>,
  );
  expect(api.externalPayer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Xác minh người trả bên ngoài' }));
  fireEvent.change(await screen.findByLabelText('Nhãn người thực trả theo sao kê'), {
    target: { value: 'SYNTHETIC OUTSIDE' },
  });
  fireEvent.change(screen.getByLabelText('Căn cứ xác minh người trả bên ngoài'), {
    target: { value: 'Synthetic statement checked' },
  });
  const submit = screen.getByRole('button', { name: 'Lưu xác minh người trả bên ngoài' });
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(submit);
  await waitFor(() => expect(api.confirmExternalPayer).toHaveBeenCalledOnce());
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  await screen.findByText(/Người thực trả bên ngoài đã xác minh: SYNTHETIC OUTSIDE/);
  expect(api.confirmExternalPayer.mock.calls[0][2]).toBe(api.confirmExternalPayer.mock.calls[1][2]);
  expect(api.confirmExternalPayer.mock.calls[1][1]).toEqual({
    expectedTransferFingerprint: 'BANK-FP',
    payerLabel: 'SYNTHETIC OUTSIDE',
    reason: 'Synthetic statement checked',
    payerHasNoResidentProfile: true,
    humanConfirmed: true,
  });
  expect(screen.getByText(/Thông tin này chưa xác nhận đã hoàn tiền/)).toBeInTheDocument();
});
