import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SePayEventsPanel } from './SePayEventsPanel';

const api = vi.hoisted(() => ({ sepayEvents: vi.fn() }));
vi.mock('./usePaymentApi', () => ({ usePaymentApi: () => api }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'owner' } }),
}));
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
function mount() {
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SePayEventsPanel />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
it('shows durable manual-review reasons and receipt navigation with server pagination', async () => {
  api.sepayEvents.mockResolvedValue({
    items: [
      {
        id: 'event',
        mode: 'Test',
        status: 'ManualReview',
        reason: 'unknown_or_ambiguous_payment_code',
        transferId: 'receipt',
        receivedAt: '2026-11-12T05:00:00Z',
      },
    ],
    totalCount: 41,
  });
  mount();
  expect(
    await screen.findByText('Mã thanh toán chưa xác định hoặc nội dung có nhiều mã.'),
  ).toBeTruthy();
  expect(
    screen.getByRole('link', { name: 'Xem giao dịch và căn cứ xác minh' }).getAttribute('href'),
  ).toBe('/payments?transferId=receipt');
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  await waitFor(() => expect(api.sepayEvents.mock.calls.at(-1)?.[0]).toBe(2));
});
it('shows failed loading and lets the Owner retry', async () => {
  api.sepayEvents.mockRejectedValue(new Error('Synthetic unavailable'));
  mount();
  expect(await screen.findByRole('alert')).toBeTruthy();
  api.sepayEvents.mockResolvedValue({ items: [], totalCount: 0 });
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText('Chưa nhận được webhook SePay.')).toBeTruthy();
});
