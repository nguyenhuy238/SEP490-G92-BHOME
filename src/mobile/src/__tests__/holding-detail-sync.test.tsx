// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useContractDetail } from '../../../../packages/client-core/src/useContractDetail';
import type { ContractClient } from '../../../../packages/client-core/src/contracts';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('polls Owner approval without unmounting the detail while the request is pending', async () => {
  vi.useFakeTimers();
  const draft = { id: 'holding', kind: 'Holding', status: 'Draft', approvedAt: null };
  const get = vi.fn().mockResolvedValue(draft);
  const api = { get } as unknown as ContractClient;
  const view = renderHook(() => useContractDetail(api, 'holding', 'Staff', 1000));
  await act(async () => {});
  expect(view.result.current.loading).toBe(false);
  const before = view.result.current.data;
  let resolve!: (value: unknown) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.data).toBe(before);
  await act(async () => resolve({ ...draft, approvedAt: '2026-11-13T00:00:00Z' }));
  expect(view.result.current.data?.contract.approvedAt).toBe('2026-11-13T00:00:00Z');
  const count = get.mock.calls.length;
  view.unmount();
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  expect(get).toHaveBeenCalledTimes(count);
});
it('keeps persisted data visible and reports a background refresh error', async () => {
  vi.useFakeTimers();
  const get = vi.fn().mockResolvedValue({ kind: 'Holding', status: 'Draft' });
  const api = { get } as unknown as ContractClient;
  const view = renderHook(() => useContractDetail(api, 'holding', 'Staff', 1000));
  await act(async () => {});
  get.mockRejectedValueOnce({ status: 503 });
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(view.result.current.data?.contract.status).toBe('Draft');
  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.error).toBe('');
  expect(view.result.current.refreshError).not.toBe('');
});
it('continues refreshing a Main contract if a related request fails on the first Active response', async () => {
  vi.useFakeTimers();
  const pending = { id: 'main', kind: 'Main', status: 'PendingActivation' };
  const active = { ...pending, status: 'Active' };
  const get = vi.fn().mockResolvedValueOnce(pending).mockResolvedValue(active);
  const moveOut = vi
    .fn()
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce({ status: 503 })
    .mockResolvedValue(null);
  const api = {
    get,
    moveOut,
    readiness: vi.fn().mockResolvedValue(null),
  } as unknown as ContractClient;
  const view = renderHook(() => useContractDetail(api, 'main', 'Staff', 1000));
  await act(async () => {});
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(view.result.current.data?.contract.status).toBe('PendingActivation');
  expect(view.result.current.refreshError).not.toBe('');
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(view.result.current.data?.contract.status).toBe('Active');
  expect(view.result.current.refreshError).toBe('');
});
it('keeps the current detail mounted during an explicit reload and on a temporary failure', async () => {
  const draft = { id: 'holding', kind: 'Holding', status: 'Draft' };
  const get = vi.fn().mockResolvedValue(draft);
  const api = { get } as unknown as ContractClient;
  const view = renderHook(() => useContractDetail(api, 'holding', 'Staff'));
  await act(async () => {});
  const before = view.result.current.data;
  let reject!: (error: unknown) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((_resolve, r) => {
        reject = r;
      }),
  );
  await act(async () => view.result.current.reload());
  expect(view.result.current.loading).toBe(false);
  expect(view.result.current.data).toBe(before);
  await act(async () => reject({ status: 503 }));
  expect(view.result.current.data).toBe(before);
  expect(view.result.current.refreshError).not.toBe('');
});
it('clears the retained contract when a refresh confirms access was revoked', async () => {
  const get = vi.fn().mockResolvedValue({ id: 'holding', kind: 'Holding', status: 'Draft' });
  const api = { get } as unknown as ContractClient;
  const view = renderHook(() => useContractDetail(api, 'holding', 'Staff'));
  await act(async () => {});
  get.mockRejectedValueOnce({ status: 403 });
  await act(async () => view.result.current.reload());
  expect(view.result.current.data).toBeNull();
  expect(view.result.current.error).not.toBe('');
});
it('does not reuse cached data for another client with the same contract id', async () => {
  const first = {
    get: vi.fn().mockResolvedValue({ id: 'holding', kind: 'Holding', status: 'Draft' }),
  } as unknown as ContractClient;
  const second = { get: vi.fn(() => new Promise(() => {})) } as unknown as ContractClient;
  const view = renderHook(({ client }) => useContractDetail(client, 'holding', 'Staff'), {
    initialProps: { client: first },
  });
  await act(async () => {});
  expect(view.result.current.data).not.toBeNull();
  view.rerender({ client: second });
  expect(view.result.current.data).toBeNull();
  expect(view.result.current.loading).toBe(true);
});
