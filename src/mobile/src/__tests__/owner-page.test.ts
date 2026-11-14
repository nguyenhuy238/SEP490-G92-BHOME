import { expect, it, vi } from 'vitest';
import { loadOwnerPage } from '../services/ownerAttention';
import { MobileApiError } from '../lib/api';
it.each([
  null,
  {},
  { items: null, totalCount: 0 },
  { items: [], totalCount: -1 },
  { items: [], totalCount: 0.5 },
  { items: [{}], totalCount: 1 },
  { items: [{ id: 'record' }], totalCount: 0 },
])('rejects malformed Owner page %j without treating it as an empty success', async (data) => {
  const api = { request: vi.fn().mockResolvedValue(data) };
  await expect(
    loadOwnerPage(api as never, '/api/v1/incidents?page=1', new AbortController().signal),
  ).rejects.toBeInstanceOf(MobileApiError);
});
it('retains authoritative totals and propagates authentication/authorization failures', async () => {
  const data = { items: [{ id: 'record', title: 'Kiểm tra phòng' }], totalCount: 50 };
  const api = {
    request: vi.fn().mockResolvedValueOnce(data).mockRejectedValueOnce(new MobileApiError(403)),
  };
  const signal = new AbortController().signal;
  await expect(loadOwnerPage(api as never, '/api/v1/operational-tasks', signal)).resolves.toEqual(
    data,
  );
  await expect(
    loadOwnerPage(api as never, '/api/v1/operational-tasks', signal),
  ).rejects.toMatchObject({ status: 403 });
  expect(api.request).toHaveBeenCalledWith('/api/v1/operational-tasks', { signal });
});
