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
