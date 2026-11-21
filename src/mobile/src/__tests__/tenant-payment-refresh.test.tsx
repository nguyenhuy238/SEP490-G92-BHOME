// @vitest-environment jsdom
import { useEffect } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileApi } from '../lib/api';
import { useTenantInvoicePayment } from '../features/tenant/useTenantInvoicePayment';
import { getToastSnapshot } from '../lib/toast';

const mocks = vi.hoisted(() => ({
  api: null as MobileApi | null,
  focused: true,
  state: 'active',
  listeners: new Set<(state: string) => void>(),
}));
vi.mock('../lib/SessionProvider', () => ({
  useSession: () => ({
    api: mocks.api,
    session: { userId: 'synthetic-tenant', roles: ['Tenant'] },
  }),
}));
vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => (() => void) | undefined) => {
    const focused = mocks.focused;
    useEffect(() => (focused ? callback() : undefined), [callback, focused]);
  },
}));
vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return mocks.state;
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mocks.listeners.add(listener);
      return { remove: () => mocks.listeners.delete(listener) };
    },
  },
}));
const invoiceId = 'ed000000-0000-4000-8000-000000000001';
const state = {
  invoiceId,
  paymentStatus: 'Unpaid',
  payableAmount: '2500000',
  paidAmount: '0',
  outstandingAmount: '2500000',
  dueDate: '2026-11-20',
  overdueDays: 0,
  history: [],
  pendingReview: false,
};
const transport = vi.fn<typeof fetch>();
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.focused = true;
  mocks.state = 'active';
  mocks.listeners.clear();
  transport.mockReset().mockResolvedValue(json(state));
  // Each request needs its own Response body.
  transport.mockImplementation(async () => json(state));
  mocks.api = new MobileApi(
    'https://api.example.invalid',
    () => 'synthetic-token',
    async () => undefined,
    vi.fn(),
    transport as typeof fetch,
  );
});
afterEach(() => {
  cleanup();
  mocks.api?.queryCache.dispose();
  vi.useRealTimers();
});

it('coalesces consumers and concurrent refreshes, bounds polling, and stops on blur', async () => {
  const { result, rerender } = renderHook(() => [
    useTenantInvoicePayment(invoiceId),
    useTenantInvoicePayment(invoiceId),
  ]);
  await flush();
  expect(transport).toHaveBeenCalledTimes(1);
  act(() => {
    result.current[0].reload();
    result.current[1].reload();
  });
  await flush();
  expect(transport).toHaveBeenCalledTimes(2);
  await advance(30_000);
  expect(transport).toHaveBeenCalledTimes(3);
  await advance(5 * 60_000);
  const bounded = transport.mock.calls.length;
  await advance(5 * 60_000);
  expect(transport).toHaveBeenCalledTimes(bounded);
  mocks.focused = false;
  rerender();
  expect(mocks.listeners.size).toBe(0);
  await advance(30_000);
  expect(transport).toHaveBeenCalledTimes(bounded);
});

it('pauses in background, refreshes on return, reports verified changes and stops when Paid', async () => {
  const { result } = renderHook(() => useTenantInvoicePayment(invoiceId));
  await flush();
  act(() => {
    mocks.state = 'background';
    mocks.listeners.forEach((listener) => listener('background'));
  });
  await advance(90_000);
  expect(transport).toHaveBeenCalledTimes(1);
  transport.mockImplementation(async () =>
    json({ ...state, paidAmount: '1000000', outstandingAmount: '1500000' }),
  );
  act(() => {
    mocks.state = 'active';
    mocks.listeners.forEach((listener) => listener('active'));
  });
  await flush();
  expect(result.current.data?.outstandingAmount).toBe('1500000');
  expect(getToastSnapshot().toast?.message).toBe('Trạng thái thanh toán đã được cập nhật.');
  transport.mockImplementation(async () =>
    json({ ...state, paymentStatus: 'Paid', paidAmount: '2500000', outstandingAmount: '0' }),
  );
  await advance(30_000);
  expect(result.current.data?.paymentStatus).toBe('Paid');
  const settled = transport.mock.calls.length;
  await advance(120_000);
  expect(transport).toHaveBeenCalledTimes(settled);
});

it('does not start overlapping requests while a payment refresh is pending', async () => {
  let complete!: (response: Response) => void;
  transport.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  const { result, unmount } = renderHook(() => useTenantInvoicePayment(invoiceId));
  await flush();
  await advance(90_000);
  act(() => {
    result.current.reload();
    result.current.reload();
  });
  expect(transport).toHaveBeenCalledTimes(1);
  await act(async () => {
    complete(json(state));
  });
  expect(result.current.data?.paymentStatus).toBe('Unpaid');
  unmount();
  await advance(90_000);
  expect(transport).toHaveBeenCalledTimes(1);
});
