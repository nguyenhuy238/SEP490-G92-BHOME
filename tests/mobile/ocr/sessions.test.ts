import { expect, it, vi } from 'vitest';
import { MobileSessions, type CredentialStore } from '../../../src/mobile/src/lib/sessions';
import { errorMessage } from '../../../src/mobile/src/lib/api';
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
    expect(errorMessage(failure)).toContain('Email hoặc mật khẩu');
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
    .mockResolvedValueOnce(new Response(JSON.stringify(session('new')), { status: 200 }));
  const manager = new MobileSessions(storage, 'https://api.test', transport);
  await Promise.all([manager.restore(), manager.restore(), manager.restore()]);
  expect(transport).toHaveBeenCalledTimes(1);
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
  transport.mockRejectedValue(new Error('network unavailable'));
  const failed = new MobileSessions(storage, 'https://new.test', transport);
  await failed.restore();
  await failed.refresh();
  expect(transport).toHaveBeenCalledTimes(1);
  expect(await storage.read()).toBeNull();
  expect(failed.snapshot.session).toBeNull();
});
it('an in-flight refresh cannot revive a locally cleared session', async () => {
  const storage = store();
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(session('login')), { status: 200 }));
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
    .mockImplementation(async () => new Response(JSON.stringify(session('dev')), { status: 200 }));
  const first = new MobileSessions(storage, 'https://api.test', transport, 'synthetic-ca-a');
  await first.login('https://api.test', 'owner.dev@example.invalid', 'synthetic-password');
  expect(JSON.parse((await storage.read())!).serverId).toBe('synthetic-ca-a');
  const restored = new MobileSessions(storage, 'https://api.test', transport, 'synthetic-ca-a');
  await restored.restore();
  expect(restored.snapshot.session?.accessToken).toBe('access-dev');
  expect(transport).toHaveBeenCalledTimes(2);
});
