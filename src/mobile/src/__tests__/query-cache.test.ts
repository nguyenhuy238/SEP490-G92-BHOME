import { afterEach, expect, it, vi } from 'vitest';
import { QueryCache } from '../lib/queryCache';
import { queryPolicies, mutationTags } from '../lib/queryPolicies';
import { MobileApi } from '../lib/api';
const caches: QueryCache[] = [];
const create = () => {
  const cache = new QueryCache();
  caches.push(cache);
  return cache;
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
it('keeps a confirmed profile PUT response when an older GET finishes later', async () => {
  const cache = create(),
    older = deferred<unknown>();
  const entry = cache.query(
    'profile-user',
    '/api/v1/account/profile',
    queryPolicies.profile,
    () => older.promise,
  );
  const read = cache.fetch(entry);
  await Promise.resolve();
  cache.setData(entry, { fullName: 'Confirmed', version: 'v2' });
  older.resolve({ fullName: 'Old', version: 'v1' });
  await read;
  expect(entry.state.data).toEqual({ fullName: 'Confirmed', version: 'v2' });
  expect(cache.isStale(entry)).toBe(false);
  cache.dispose();
  cache.setData(entry, { fullName: 'Must not reappear' });
  expect(entry.state.hasData).toBe(false);
});
afterEach(() => {
  caches.forEach((cache) => cache.dispose());
  caches.length = 0;
  vi.useRealTimers();
});
it('deduplicates simultaneous subscribers and remounts while data is fresh', async () => {
  const cache = create(),
    response = deferred<unknown>(),
    load = vi.fn(() => response.promise);
  const entry = cache.query('user:Tenant', '/api/v1/contracts', queryPolicies.contracts, load);
  const leave = cache.activate(entry);
  const done = cache.fetch(entry, true);
  leave();
  cache.activate(entry);
  await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(1);
  response.resolve({ id: 'contract' });
  await done;
  await cache.fetch(entry);
  expect(load).toHaveBeenCalledTimes(1);
});
it('retains cached content during stale refresh, a network failure and explicit retry', async () => {
  vi.useFakeTimers();
  const cache = create(),
    response = deferred<unknown>();
  const load = vi
    .fn()
    .mockResolvedValueOnce('last-success')
    .mockImplementationOnce(() => response.promise)
    .mockResolvedValueOnce('recovered');
  const entry = cache.query('user', '/api/v1/debts', queryPolicies.debts, load);
  await cache.fetch(entry);
  await vi.advanceTimersByTimeAsync(60_001);
  const done = cache.fetch(entry);
  expect(entry.state).toMatchObject({ data: 'last-success', hasData: true, fetching: true });
  response.reject({ status: 0 });
  await done;
  expect(entry.state).toMatchObject({ data: 'last-success', hasData: true, fetching: false });
  await cache.fetch(entry, true);
  expect(entry.state).toMatchObject({ data: 'recovered', error: null });
});
it.each([401, 403, 404])(
  'removes cached private content on authorization/resource failure %s',
  async (status) => {
    const cache = create(),
      load = vi.fn().mockResolvedValueOnce('private').mockRejectedValueOnce({ status });
    const entry = cache.query('user', '/api/v1/contracts', queryPolicies.contracts, load);
    await cache.fetch(entry);
    await cache.fetch(entry, true);
    expect(entry.state).toMatchObject({ data: undefined, hasData: false, error: { status } });
  },
);
it('invalidates related resources only, and waits until inactive observers return', async () => {
  const cache = create(),
    tasks = vi.fn().mockResolvedValue('tasks'),
    contracts = vi.fn().mockResolvedValue('contracts');
  const taskEntry = cache.query('user', '/api/v1/operational-tasks', queryPolicies.tasks, tasks);
  const contractEntry = cache.query(
    'user',
    '/api/v1/contracts',
    queryPolicies.contracts,
    contracts,
  );
  const leave = cache.activate(taskEntry);
  cache.activate(contractEntry);
  await Promise.all([cache.fetch(taskEntry), cache.fetch(contractEntry)]);
  leave();
  cache.invalidate(['tasks']);
  expect(tasks).toHaveBeenCalledTimes(1);
  cache.activate(taskEntry);
  await cache.fetch(taskEntry);
  expect(tasks).toHaveBeenCalledTimes(2);
  expect(contracts).toHaveBeenCalledTimes(1);
});
it('does not fetch while backgrounded; foreground refreshes only stale active entries', async () => {
  vi.useFakeTimers();
  const cache = create();
  const load = vi.fn().mockResolvedValue('tasks'),
    roomLoad = vi.fn().mockResolvedValue('room');
  const task = cache.query('user', '/api/v1/operational-tasks', queryPolicies.tasks, load);
  const room = cache.query('user', '/api/v1/capture/locations', queryPolicies.rooms, roomLoad);
  cache.activate(task);
  cache.activate(room);
  await Promise.all([cache.fetch(task), cache.fetch(room)]);
  cache.setForeground(false);
  await vi.advanceTimersByTimeAsync(31_000);
  await cache.fetch(task, true);
  expect(load).toHaveBeenCalledTimes(1);
  cache.setForeground(true);
  await cache.fetch(task);
  expect(load).toHaveBeenCalledTimes(2);
  expect(roomLoad).toHaveBeenCalledTimes(1);
  cache.setForeground(false);
  cache.setForeground(true);
  await cache.fetch(task);
  expect(load).toHaveBeenCalledTimes(2);
});
it('discards an older in-flight result after invalidation', async () => {
  const cache = create(),
    old = deferred<unknown>();
  const load = vi
    .fn()
    .mockImplementationOnce(() => old.promise)
    .mockResolvedValue('new');
  const entry = cache.query('user', '/api/v1/operational-tasks', queryPolicies.tasks, load);
  cache.activate(entry);
  const original = cache.fetch(entry);
  await Promise.resolve();
  cache.invalidate(['tasks']);
  await cache.fetch(entry);
  old.resolve('old');
  await original;
  expect(entry.state.data).toBe('new');
});
it('clears data and rejects late responses after session disposal', async () => {
  const cache = create(),
    response = deferred<unknown>();
  const entry = cache.query(
    'tenant-a',
    '/api/v1/contracts',
    queryPolicies.contracts,
    () => response.promise,
  );
  const pending = cache.fetch(entry);
  await Promise.resolve();
  cache.dispose();
  response.resolve('tenant-a-private');
  await pending;
  expect(entry.state.hasData).toBe(false);
  const next = create().query(
    'tenant-b',
    '/api/v1/contracts',
    queryPolicies.contracts,
    async () => 'b',
  );
  expect(next.state.data).toBeUndefined();
});
it('keeps role/decoder keys separate and garbage collects inactive data after 20 minutes', async () => {
  vi.useFakeTimers();
  const cache = create(),
    load = vi.fn().mockResolvedValue('data');
  const first = cache.query('user:Tenant', '/api/v1/contracts', queryPolicies.contracts, load);
  expect(cache.query('user:Staff', first.path, first.policy, load)).not.toBe(first);
  expect(cache.query('user:Tenant', first.path, first.policy, load, load)).not.toBe(first);
  await cache.fetch(first);
  cache.subscribe(first, () => {})();
  await vi.advanceTimersByTimeAsync(20 * 60_000);
  const next = cache.query('user:Tenant', first.path, first.policy, load);
  expect(next).not.toBe(first);
  expect(next.state.hasData).toBe(false);
});
it('successful API mutations invalidate task data while failed mutations do not', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('{}', { status: 409 }))
    .mockResolvedValueOnce(new Response('{}'));
  const api = new MobileApi(
    'https://api.example.invalid',
    () => 'synthetic',
    async () => undefined,
    vi.fn(),
    transport as typeof fetch,
  );
  caches.push(api.queryCache);
  const load = vi.fn().mockResolvedValue('task');
  const entry = api.queryCache.query(
    'staff',
    '/api/v1/operational-tasks',
    queryPolicies.tasks,
    load,
  );
  api.queryCache.activate(entry);
  await api.queryCache.fetch(entry);
  await expect(api.json('/api/v1/operational-tasks/id/complete', {})).rejects.toMatchObject({
    status: 409,
  });
  expect(load).toHaveBeenCalledTimes(1);
  await api.json('/api/v1/operational-tasks/id/complete', {});
  await api.queryCache.fetch(entry);
  expect(load).toHaveBeenCalledTimes(2);
  expect(mutationTags('/api/v1/capture/meter-tasks/id/confirm')).toContain('meters');
  expect(mutationTags('/api/v1/incidents/id/status')).toContain('incidents');
  expect(mutationTags('/api/v1/capture/meter-tasks/id/evidence')).toEqual([]);
});
it('reconciles observed backend payment changes without assuming success locally', async () => {
  const cache = create(),
    load = vi.fn().mockResolvedValue('balance');
  const entry = cache.query('tenant', '/api/v1/debts', queryPolicies.debts, load);
  cache.activate(entry);
  await cache.fetch(entry);
  const path = '/api/v1/invoices/bill/payment';
  cache.observePayment(path, { paymentStatus: 'Unpaid', outstandingAmount: '100' });
  cache.observePayment(path, { paymentStatus: 'Unpaid', outstandingAmount: '100' });
  expect(load).toHaveBeenCalledTimes(1);
  cache.observePayment(path, { paymentStatus: 'Paid', outstandingAmount: '0' });
  await cache.fetch(entry);
  expect(load).toHaveBeenCalledTimes(2);
});
it('invalidates financial data only for newly observed relevant notifications', async () => {
  const cache = create(),
    debtLoad = vi.fn().mockResolvedValue('debt'),
    roomLoad = vi.fn().mockResolvedValue('room');
  const debt = cache.query('user', '/api/v1/debts', queryPolicies.debts, debtLoad);
  const room = cache.query('user', '/api/v1/capture/locations', queryPolicies.rooms, roomLoad);
  cache.activate(debt);
  cache.activate(room);
  await Promise.all([cache.fetch(debt), cache.fetch(room)]);
  const path = '/api/v1/notifications?page=1&pageSize=3&unread=true';
  cache.observeNotifications(path, { items: [{ id: 'before', category: 'Payment' }] });
  cache.observeNotifications(path, {
    items: [{ id: 'before', category: 'Payment', readAt: '2026-11-07' }],
  });
  expect(debtLoad).toHaveBeenCalledTimes(1);
  cache.observeNotifications(path, { items: [{ id: 'new-payment', category: 'Payment' }] });
  await cache.fetch(debt);
  expect(debtLoad).toHaveBeenCalledTimes(2);
  expect(roomLoad).toHaveBeenCalledTimes(1);
});
it('does not start a deferred read if the app backgrounds before transport starts', async () => {
  const cache = create(),
    load = vi.fn().mockResolvedValue('data');
  const entry = cache.query('user', '/api/v1/contracts', queryPolicies.contracts, load);
  const done = cache.fetch(entry);
  cache.setForeground(false);
  await done;
  expect(load).not.toHaveBeenCalled();
});
