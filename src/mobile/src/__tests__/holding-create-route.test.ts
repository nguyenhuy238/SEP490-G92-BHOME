import { expect, it, vi } from 'vitest';
import { contractClient, type ContractRequest } from '../../../../packages/client-core/src/contracts';

it('creates Holding through its dedicated endpoint and preserves Main creation and contract actions', async () => {
  const request = vi.fn<ContractRequest>().mockResolvedValue({ id: 'contract-id' });
  const api = contractClient(request as ContractRequest);
  const body = { holdingDeposit: '3000000' };
  await api.mutate(null, 'holdings', body, 'holding-key');
  expect(request).toHaveBeenLastCalledWith('/api/v1/contracts/holdings', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'holding-key' },
    body: JSON.stringify(body),
  });
  await api.mutate(null, '', {}, 'main-key');
  expect(request.mock.calls.at(-1)?.[0]).toBe('/api/v1/contracts');
  await api.mutate('contract-id', 'approve', undefined, 'approval-key');
  expect(request.mock.calls.at(-1)?.[0]).toBe('/api/v1/contracts/contract-id/approve');
});
