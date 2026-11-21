// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useContractDetail } from '../../../../packages/client-core/src/useContractDetail';
import type { ContractClient } from '../../../../packages/client-core/src/contracts';

afterEach(cleanup);
it('loads backend deposit readiness for Staff without loading financial history', async () => {
  const readiness = {
    ready: true,
    verifiedDeposit: '3000000',
    remainingDeposit: '0',
    blockers: [],
  };
  const api = {
    get: vi.fn().mockResolvedValue({ kind: 'Main', status: 'PendingActivation' }),
    moveOut: vi.fn().mockResolvedValue(null),
    readiness: vi.fn().mockResolvedValue(readiness),
    history: vi.fn(),
  };
  const { result } = renderHook(() =>
    useContractDetail(api as unknown as ContractClient, 'main', 'Staff'),
  );
  await waitFor(() => expect(result.current.data?.readiness).toEqual(readiness));
  expect(api.readiness).toHaveBeenCalledWith('main', expect.any(AbortSignal));
  expect(api.history).not.toHaveBeenCalled();
});
it('loads Holding as Holding despite legacy draft metadata and never requests Main move-out data', async () => {
  const api = {
    get: vi.fn().mockResolvedValue({
      id: 'holding',
      kind: 'Holding',
      status: 'Draft',
      onboardingDraft: true,
    }),
    moveOut: vi.fn(),
    readiness: vi.fn().mockResolvedValue({ ready: false, blockers: [] }),
    history: vi.fn(),
  };
  const { result } = renderHook(() =>
    useContractDetail(api as unknown as ContractClient, 'holding', 'Owner'),
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.data?.contract.kind).toBe('Holding');
  expect(api.readiness).toHaveBeenCalledWith('holding', expect.any(AbortSignal));
  expect(api.moveOut).not.toHaveBeenCalled();
  expect(api.history).not.toHaveBeenCalled();
});

it('keeps Main draft preparation separate from released Main signing/handover', async () => {
  const api = {
    get: vi.fn().mockResolvedValue({ kind: 'Main', status: 'Draft', onboardingDraft: true }),
    moveOut: vi.fn(),
    readiness: vi.fn(),
    history: vi.fn(),
  };
  const { result } = renderHook(() =>
    useContractDetail(api as unknown as ContractClient, 'main', 'Staff'),
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.data?.contract.onboardingDraft).toBe(true);
  expect(api.moveOut).not.toHaveBeenCalled();
  expect(api.readiness).not.toHaveBeenCalled();
});
