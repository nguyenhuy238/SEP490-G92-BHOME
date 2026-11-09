import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useOwnerAction } from './useOwnerWorkspace';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../features/meters/useMeterApi', () => ({
  useMeterApi: () => ({ request: mocks.request }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('retires a confirmed intent but preserves the same idempotency key for an uncertain retry', async () => {
  const cache = new QueryClient();
  const { result } = renderHook(() => useOwnerAction(), {
    wrapper: ({ children }) => <QueryClientProvider client={cache}>{children}</QueryClientProvider>,
  });
  mocks.request.mockResolvedValue({ id: 'first' });
  const send = () =>
    result.current.run(() =>
      result.current.command('/api/v1/test-intent', 'POST', { title: 'same input' }),
    );
  await act(async () => {
    expect(await send()).toBe(true);
  });
  mocks.request.mockRejectedValueOnce(new Error('Synthetic interruption'));
  await act(async () => {
    expect(await send()).toBe(false);
  });
  await act(async () => {
    expect(await send()).toBe(true);
  });
  const keys = mocks.request.mock.calls.map(([, init]) => init.headers['Idempotency-Key']);
  expect(keys[0]).not.toBe(keys[1]);
  expect(keys[1]).toBe(keys[2]);
});
