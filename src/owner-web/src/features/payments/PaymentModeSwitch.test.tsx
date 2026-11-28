import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { PaymentModeSwitch } from './PaymentModeSwitch';

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./usePaymentApi', () => ({ usePaymentApi: () => api }));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'synthetic-owner' } }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <PaymentModeSwitch />
    </QueryClientProvider>,
  );
}
it('switches Test to Live and back using the confirmed server mode', async () => {
  let mode = 'Test';
  api.request.mockImplementation(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const input = JSON.parse(String(init.body));
      expect(input.expectedMode).toBe(mode);
      mode = input.mode;
    }
    return { mode, testAvailable: true, liveAvailable: true };
  });
  mount();
  const toggle = await screen.findByRole('button', { name: 'Live Mode' });
  expect(screen.getByRole('button', { name: 'Test Mode' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));
  await waitFor(() => expect(toggle).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Test Mode' }));
  await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'false'));
  expect(api.request.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(2);
  expect(screen.queryByText(/không được tính vào doanh thu/)).not.toBeInTheDocument();
});
it('keeps the confirmed mode and shows a failed save without duplicate writes', async () => {
  let rejectSave: (reason: unknown) => void = () => {};
  api.request.mockImplementation(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'PUT')
      return new Promise((_, reject) => {
        rejectSave = reject;
      });
    return { mode: 'Test', testAvailable: true, liveAvailable: false };
  });
  mount();
  const toggle = await screen.findByRole('button', { name: 'Live Mode' });
  fireEvent.click(toggle);
  fireEvent.click(toggle);
  expect(toggle).toBeDisabled();
  expect(api.request.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  rejectSave(new Error('synthetic failure'));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Test Mode' })).toHaveAttribute('aria-pressed', 'true');
  await waitFor(() => expect(toggle).not.toBeDisabled());
});
