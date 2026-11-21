import { expect, it, vi } from 'vitest';
import { MobileSessions, type CredentialStore } from '../../../src/mobile/src/lib/sessions';
import { errorMessage } from '../../../src/mobile/src/lib/api';
import { queryPolicies } from '../../../src/mobile/src/lib/queryPolicies';
function store() {
  let value: string | null = null;
  return {
    read: async () => value,
    write: async (v: string) => {
      value = v;
    },
    remove: async () => {
      value = null;
    },
  } satisfies CredentialStore;
}
const session = (n: string) => ({
  userId: 'synthetic',
  roles: ['Staff'],
  accessToken: 'access-' + n,
  refreshToken: 'refresh-' + n,
});

it.each([403, 429])(
  'does not revoke the current native session when refresh returns a known %s rejection',
  async (status) => {
    const storage = store();
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(session('login'))))
      .mockResolvedValueOnce(new Response('Healthy'))
      .mockResolvedValueOnce(new Response('', { status }));
    const manager = new MobileSessions(storage, 'https://api.test', transport);
    await manager.login('https://api.test', 'staff@example.invalid', 'synthetic');
    await expect(manager.refresh()).rejects.toMatchObject({ status });
    expect(manager.snapshot.session?.accessToken).toBe('access-login');
    expect(await storage.read()).toContain('refresh-login');
  },
);

it('keeps an existing valid access session on an ambiguous network result but removes the consumed-risk refresh credential', async () => {
  const storage = store();
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(session('login'))))
    .mockResolvedValueOnce(new Response('Healthy'))
    .mockRejectedValueOnce(new TypeError('connection lost after submission'));
  const manager = new MobileSessions(storage, 'https://api.test', transport);
  await manager.login('https://api.test', 'staff@example.invalid', 'synthetic');
  await expect(manager.refresh()).rejects.toMatchObject({ status: 0 });
  expect(manager.snapshot.session?.accessToken).toBe('access-login');
  expect(await storage.read()).toBeNull();
  await manager.refresh();
  expect(transport).toHaveBeenCalledTimes(3);
});
it('clears private query data on logout and never reuses a previous account cache', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).endsWith('/logout')
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(session('login'))),
    );
  const manager = new MobileSessions(store(), 'https://api.test', transport);
  await manager.login('https://api.test', 'first@example.invalid', 'synthetic');
  const old = manager.snapshot.api!;
  const entry = old.queryCache.query(
    'first',
    '/api/v1/contracts',
    queryPolicies.contracts,
    async () => 'PRIVATE-FIRST',
  );
  await old.queryCache.fetch(entry);
  await manager.logout();
  expect(entry.state.hasData).toBe(false);
  expect(manager.snapshot.api).toBeNull();
  await manager.login('https://api.test', 'second@example.invalid', 'synthetic');
  expect(manager.snapshot.api).not.toBe(old);
  const next = manager.snapshot.api!.queryCache.query(
    'second',
    '/api/v1/contracts',
    queryPolicies.contracts,
    async () => 'second',
  );
  expect(next.state.hasData).toBe(false);
  await manager.clear();
});
it('preserves a cache across token rotation but retires it when refreshed roles change', async () => {
  let role = 'Staff';
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).includes('/health')
        ? new Response('Healthy')
        : new Response(JSON.stringify({ ...session('next'), roles: [role] })),
    );
  const manager = new MobileSessions(store(), 'https://api.test', transport);
  await manager.login('https://api.test', 'staff@example.invalid', 'synthetic');
  const original = manager.snapshot.api!;
  const entry = original.queryCache.query(
    'staff',
    '/api/v1/capture/locations',
    queryPolicies.rooms,
    async () => 'PRIVATE-STAFF',
  );
  await original.queryCache.fetch(entry);
  await manager.refresh();
  expect(manager.snapshot.api).toBe(original);
  expect(entry.state.hasData).toBe(true);
  role = 'Tenant';
  await manager.refresh();
  expect(manager.snapshot.api).not.toBe(original);
  expect(entry.state.hasData).toBe(false);
  await manager.clear();
});
it('logs in using the email API contract and preserves the password exactly', async () => {
  const storage = store();
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(session('login')), { status: 200 }));
  const manager = new MobileSessions(storage, 'https://api.test', transport);
  await manager.login('https://api.test/', '  owner.dev@example.invalid  ', ' synthetic-password ');
  expect(transport).toHaveBeenCalledTimes(1);
  const [url, request] = transport.mock.calls[0]!;
  expect(url).toBe('https://api.test/api/v1/auth/login');
  expect(JSON.parse(request!.body as string)).toEqual({
    email: 'owner.dev@example.invalid',
    password: ' synthetic-password ',
    device: 'BHOME Mobile',
  });
  expect(request!.credentials).toBe('omit');
  expect(request!.cache).toBe('no-store');
  expect(manager.snapshot.session?.accessToken).toBe('access-login');
});
it.each([400, 401, 0])('does not save a session or retry a failed login (%s)', async (status) => {
  const storage = store();
  const transport = vi.fn<typeof fetch>();
  if (status) transport.mockResolvedValue(new Response('', { status }));
  else transport.mockRejectedValue(new Error('PRIVATE_NETWORK_DETAIL'));
  const manager = new MobileSessions(storage, 'https://api.test', transport);
  const failure = await manager
    .login('https://api.test', 'owner.dev@example.invalid', 'synthetic-password')
    .catch((error: unknown) => error);
  expect(failure).toMatchObject({ status });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(await storage.read()).toBeNull();
  expect(manager.snapshot.session).toBeNull();
  expect(errorMessage(failure)).not.toContain('PRIVATE_NETWORK_DETAIL');
  if (status === 401) {
    expect(errorMessage(failure)).toContain('Email, số điện thoại hoặc mật khẩu không chính xác');
    expect(errorMessage(failure)).not.toContain('hết hạn');
  }
});
it('rejects HTTP before sending login credentials', async () => {
  const storage = store();
  const transport = vi.fn<typeof fetch>();
  const manager = new MobileSessions(storage, 'https://api.test', transport);
  await expect(
    manager.login('http://api.test', 'owner.dev@example.invalid', 'synthetic-password'),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
  expect(await storage.read()).toBeNull();
});
it('coalesces restore and refresh, and persists only API binding + refresh credential', async () => {
  const storage = store();
  await storage.write(JSON.stringify({ base: 'https://api.test', refreshToken: 'refresh-old' }));
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('Healthy'))
    .mockResolvedValueOnce(new Response(JSON.stringify(session('new')), { status: 200 }));
  const manager = new MobileSessions(storage, 'https://api.test', transport);
  await Promise.all([manager.restore(), manager.restore(), manager.restore()]);
  expect(transport).toHaveBeenCalledTimes(2);
  expect(manager.snapshot.session?.accessToken).toBe('access-new');
  const saved = await storage.read();
  expect(saved).toContain('refresh-new');
  expect(saved).not.toContain('access-new');
  expect(saved).not.toContain('Staff');
});
it('does not restore a credential to another server or retry an ambiguous refresh', async () => {
  const storage = store();
  await storage.write(JSON.stringify({ base: 'https://old.test', refreshToken: 'old' }));
  const transport = vi.fn<typeof fetch>();
  const changed = new MobileSessions(storage, 'https://new.test', transport);
  await changed.restore();
  expect(transport).not.toHaveBeenCalled();
  expect(await storage.read()).toBeNull();
  expect(changed.snapshot).toMatchObject({
    baseUrl: 'https://new.test',
    ready: true,
    session: null,
  });
  await storage.write(JSON.stringify({ base: 'https://new.test', refreshToken: 'old' }));
  transport
    .mockResolvedValueOnce(new Response('Healthy'))
    .mockRejectedValue(new Error('network unavailable'));
  const failed = new MobileSessions(storage, 'https://new.test', transport);
  await failed.restore();
  await failed.refresh();
  expect(transport).toHaveBeenCalledTimes(2);
  expect(await storage.read()).toBeNull();
  expect(failed.snapshot.session).toBeNull();
});
it('an in-flight refresh cannot revive a locally cleared session', async () => {
  const storage = store();
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(session('login')), { status: 200 }))
    .mockResolvedValueOnce(new Response('Healthy'));
  const manager = new MobileSessions(storage, 'https://api.test', transport);
  await manager.login('https://api.test', 'staff.dev@example.invalid', 'synthetic-password');
  let respond!: (response: Response) => void;
  transport.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const refresh = manager.refresh();
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(3));
  await manager.clear();
  respond(new Response(JSON.stringify(session('late')), { status: 200 }));
  await refresh;
  expect(manager.snapshot.session).toBeNull();
  expect(await storage.read()).toBeNull();
});

it('does not send a saved refresh token to a different developer reusing the same IP', async () => {
  const storage = store();
  await storage.write(
    JSON.stringify({ base: 'https://api.test', refreshToken: 'old', serverId: 'synthetic-ca-a' }),
  );
  const transport = vi.fn<typeof fetch>();
  const manager = new MobileSessions(storage, 'https://api.test', transport, 'synthetic-ca-b');
  await manager.restore();
  expect(transport).not.toHaveBeenCalled();
  expect(await storage.read()).toBeNull();
  expect(manager.snapshot.session).toBeNull();
});

it('restores sessions only for the same development origin and server identity', async () => {
  const storage = store();
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).endsWith('/health/ready')
        ? new Response('Healthy')
        : new Response(JSON.stringify(session('dev')), { status: 200 }),
    );
  const first = new MobileSessions(storage, 'https://api.test', transport, 'synthetic-ca-a');
  await first.login('https://api.test', 'owner.dev@example.invalid', 'synthetic-password');
  expect(JSON.parse((await storage.read())!).serverId).toBe('synthetic-ca-a');
  const restored = new MobileSessions(storage, 'https://api.test', transport, 'synthetic-ca-a');
  await restored.restore();
  expect(restored.snapshot.session?.accessToken).toBe('access-dev');
  expect(transport).toHaveBeenCalledTimes(3);
});

it.each([0, 503])(
  'keeps a saved session when the anonymous readiness probe fails (%s), and restores after reconnection',
  async (status) => {
    const storage = store();
    await storage.write(JSON.stringify({ base: 'https://api.test', refreshToken: 'refresh-old' }));
    const transport = vi.fn<typeof fetch>();
    if (status) transport.mockResolvedValueOnce(new Response('', { status }));
    else transport.mockRejectedValueOnce(new TypeError('offline'));
    transport
      .mockResolvedValueOnce(new Response('Healthy'))
      .mockResolvedValueOnce(new Response(JSON.stringify(session('reconnected'))));
    const manager = new MobileSessions(storage, 'https://api.test', transport);
    await manager.restore();
    expect(await storage.read()).toContain('refresh-old');
    expect(manager.snapshot.ready).toBe(true);
    expect(manager.snapshot.session).toBeNull();
    expect(manager.snapshot.restoreError).toBeTruthy();
    expect(transport.mock.calls[0]![0]).toBe('https://api.test/health/ready');
    expect(transport.mock.calls[0]![1]?.body).toBeUndefined();
    await Promise.all([manager.reconnect(), manager.reconnect()]);
    expect(transport).toHaveBeenCalledTimes(3);
    expect(manager.snapshot.session?.accessToken).toBe('access-reconnected');
    expect(manager.snapshot.restoreError).toBeUndefined();
    expect(await storage.read()).toContain('refresh-reconnected');
    await manager.reconnect();
    expect(transport).toHaveBeenCalledTimes(3);
  },
);

it('logout during a connectivity probe prevents refresh and automatic reconnection', async () => {
  const storage = store();
  await storage.write(JSON.stringify({ base: 'https://api.test', refreshToken: 'refresh-old' }));
  let respond!: (value: Response) => void;
  const transport = vi.fn<typeof fetch>().mockImplementation(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const manager = new MobileSessions(storage, 'https://api.test', transport);
  const restore = manager.restore();
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  await manager.clear();
  respond(new Response('Healthy'));
  await restore;
  await manager.reconnect();
  expect(transport).toHaveBeenCalledTimes(1);
  expect(await storage.read()).toBeNull();
  expect(manager.snapshot.session).toBeNull();
});
