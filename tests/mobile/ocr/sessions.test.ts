import { expect, it, vi } from 'vitest';
import { MobileSessions, type CredentialStore } from '../../../src/mobile/src/lib/sessions';
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
  await manager.login('https://api.test', 'synthetic', 'synthetic-password');
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
