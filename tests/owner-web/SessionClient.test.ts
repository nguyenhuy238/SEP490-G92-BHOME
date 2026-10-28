import { afterEach, vi } from 'vitest';
import { SessionClient } from '@bhome/client-core/sessionClient.ts';
import { createApiClient } from '@bhome/client-core/api.ts';

const session = {
  userId: 'synthetic-user',
  roles: ['Owner'],
  accessToken: 'access-one',
  refreshToken: 'refresh-one',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

it('serializes web cookie mutations with Web Locks and retries logout after expired access', async () => {
  const lock = vi.fn((_name: string, action: () => Promise<unknown>) => action());
  vi.stubGlobal('navigator', { locks: { request: lock } });
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json({ ...session, refreshToken: null }))
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ ...session, refreshToken: null, accessToken: 'access-two' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })),
  );
  const client = new SessionClient('https://api.example.invalid', 'web');
  await client.login('synthetic', 'test-password');
  await client.logout();
  expect(lock).toHaveBeenCalledTimes(4);
  expect(client.session).toBeNull();
});

it('keeps web refresh credentials in cookie transport and access tokens out of storage', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  const fetchMock = vi.fn().mockResolvedValue(json({ ...session, refreshToken: null }));
  vi.stubGlobal('fetch', fetchMock);
  const client = new SessionClient('https://api.example.invalid', 'web');
  await client.login('synthetic', 'test-password');
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  expect(init.credentials).toBe('include');
  expect(new Headers(init.headers).get('X-BHome-Client')).toBe('web');
  expect(storage).not.toHaveBeenCalled();
  expect(client.token).toBe('access-one');
});

it('coalesces simultaneous mobile refresh and rotates the in-memory token', async () => {
  let complete!: (value: Response) => void;
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json(session))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
  vi.stubGlobal('fetch', fetchMock);
  const client = new SessionClient('https://api.example.invalid', 'mobile');
  await client.login('synthetic', 'test-password');
  const first = client.refresh();
  const second = client.refresh();
  expect(first).toBe(second);
  complete(json({ ...session, accessToken: 'access-two', refreshToken: 'refresh-two' }));
  expect(await first).toBe('access-two');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
    refreshToken: 'refresh-one',
  });
  expect(fetchMock.mock.calls[1][1].credentials).toBe('omit');
  await client.refresh().catch(() => undefined);
  expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual({
    refreshToken: 'refresh-two',
  });
});

it('retries protected requests once with the shared refreshed access token', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json(session))
    .mockResolvedValueOnce(json({}, 401))
    .mockResolvedValueOnce(
      json({ ...session, accessToken: 'access-two', refreshToken: 'refresh-two' }),
    )
    .mockResolvedValueOnce(json({ userId: session.userId }));
  vi.stubGlobal('fetch', fetchMock);
  const client = new SessionClient('https://api.example.invalid', 'mobile');
  await client.login('synthetic', 'test-password');
  const api = createApiClient(
    'https://api.example.invalid',
    () => client.token,
    client.clear,
    client.refresh,
  );
  expect(await api('/api/v1/session')).toEqual({ userId: session.userId });
  expect(new Headers(fetchMock.mock.calls[3][1].headers).get('Authorization')).toBe(
    'Bearer access-two',
  );
});

it('clears local credentials when refresh is revoked', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json({}, 401)),
  );
  const client = new SessionClient('https://api.example.invalid', 'mobile');
  await client.login('synthetic', 'test-password');
  await expect(client.refresh()).rejects.toMatchObject({ status: 401 });
  expect(client.session).toBeNull();
});

it('does not resurrect a cleared session when an older refresh finishes', async () => {
  let complete!: (value: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json(session))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          }),
      ),
  );
  const client = new SessionClient('https://api.example.invalid', 'mobile');
  await client.login('synthetic', 'test-password');
  const pending = client.refresh();
  client.clear();
  complete(json({ ...session, accessToken: 'stale-access' }));
  expect(await pending).toBeUndefined();
  expect(client.session).toBeNull();
});

it('refreshes an expired access token before completing server logout and clearing memory', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json(session))
    .mockResolvedValueOnce(json({}, 401))
    .mockResolvedValueOnce(json({ ...session, accessToken: 'access-two' }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  const client = new SessionClient('https://api.example.invalid', 'mobile');
  await client.login('synthetic', 'test-password');
  await client.logout();
  expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
    'https://api.example.invalid/api/v1/auth/login',
    'https://api.example.invalid/api/v1/auth/logout',
    'https://api.example.invalid/api/v1/auth/refresh',
    'https://api.example.invalid/api/v1/auth/logout',
  ]);
  expect(client.session).toBeNull();
});

it('preserves a session on a temporary refresh outage instead of pretending logout succeeded', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json({}, 503)),
  );
  const client = new SessionClient('https://api.example.invalid', 'mobile');
  await client.login('synthetic', 'test-password');
  await expect(client.refresh()).rejects.toMatchObject({ status: 503 });
  expect(client.token).toBe('access-one');
});
