import { afterEach, expect, it, vi } from 'vitest';
import type { Session } from '../../../../../packages/client-core/src/auth';
import { SessionClient } from '../../../../../packages/client-core/src/sessionClient';

const session: Session = {
  userId: 'synthetic-owner',
  roles: ['Owner'],
  accessToken: 'synthetic-access-token',
  sessionId: 'synthetic-session',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => vi.unstubAllGlobals());

it('coalesces concurrent web refresh calls into one cookie rotation request', async () => {
  let finish!: (response: Response) => void;
  const fetchMock = vi.fn().mockReturnValue(
    new Promise<Response>((resolve) => {
      finish = resolve;
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const client = new SessionClient('https://api.example.invalid', 'web');

  const first = client.refresh();
  const second = client.refresh();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  finish(json(session));

  await expect(Promise.all([first, second])).resolves.toEqual([
    'synthetic-access-token',
    'synthetic-access-token',
  ]);
  expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.invalid/api/v1/auth/refresh');
});

it('keeps the local session when server-side logout cannot be confirmed', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network unavailable')));
  const client = new SessionClient('https://api.example.invalid', 'web');
  client.accept(session);

  await expect(client.logout()).rejects.toMatchObject({ status: 0 });
  expect(client.session).toMatchObject({ sessionId: 'synthetic-session', roles: ['Owner'] });
});
