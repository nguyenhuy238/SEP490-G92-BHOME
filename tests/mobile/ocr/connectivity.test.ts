import { afterEach, expect, it, vi } from 'vitest';
import {
  MobileApi,
  MobileApiError,
  checkApiConnection,
  errorMessage,
} from '../../../src/mobile/src/lib/api';
import { MobileSessions, type CredentialStore } from '../../../src/mobile/src/lib/sessions';
import { contractClient, contractError } from '../../../packages/client-core/src/contracts';
import { loadOwnerOverview } from '../../../src/mobile/src/services/ownerOverview';

const correlationId = '00000000-0000-0000-0000-000000000001';
function api(fetcher: typeof fetch, refresh = vi.fn().mockResolvedValue(undefined)) {
  return new MobileApi('https://api.test', () => 'synthetic-access', refresh, vi.fn(), fetcher);
}
function storage(): CredentialStore {
  let value: string | null = null;
  return {
    read: async () => value,
    write: async (next) => {
      value = next;
    },
    remove: async () => {
      value = null;
    },
  };
}
const validSession = {
  userId: 'synthetic-user',
  accessToken: 'synthetic-access',
  refreshToken: 'synthetic-refresh',
  roles: ['Owner'],
};
it('an obsolete API never sends a new-origin credential or clears a newer login on 401', async () => {
  const store = storage();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).endsWith('/login')
        ? new Response(JSON.stringify(validSession))
        : new Response('{}', { status: 401 }),
    );
  const sessions = new MobileSessions(store, 'https://api.test', fetcher);
  await sessions.login('https://api.test', 'owner@example.invalid', 'synthetic');
  const obsolete = sessions.snapshot.api!;
  await sessions.login('https://other.test', 'owner@example.invalid', 'synthetic');
  await expect(obsolete.request('/api/v1/contracts')).rejects.toMatchObject({ status: 401 });
  const [url, init] = fetcher.mock.calls.at(-1)!;
  expect(url).toBe('https://api.test/api/v1/contracts');
  expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  expect(sessions.snapshot.session).not.toBeNull();
  expect(sessions.snapshot.baseUrl).toBe('https://other.test');
});
afterEach(() => vi.useRealTimers());
it('never accepts login when native secure storage fails, and completes restore without an unhandled rejection', async () => {
  const store = storage();
  store.remove = vi.fn().mockRejectedValue(new Error('PRIVATE_KEYCHAIN_DETAIL'));
  store.read = vi.fn().mockRejectedValue(new Error('PRIVATE_KEYCHAIN_DETAIL'));
  const fetcher = vi.fn<typeof fetch>();
  const sessions = new MobileSessions(store, 'https://api.test', fetcher);
  await sessions.restore();
  expect(sessions.snapshot.ready).toBe(true);
  await expect(
    sessions.login('https://api.test', 'owner@example.invalid', 'synthetic'),
  ).rejects.toMatchObject({ code: 'secure_storage_unavailable' });
  expect(sessions.snapshot.session).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  expect(errorMessage(new MobileApiError(0, 'secure_storage_unavailable'))).toContain(
    'kho bảo mật',
  );
});
it('coalesces concurrent expired requests into one token rotation and retries each request once', async () => {
  const store = storage();
  let refreshes = 0;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).endsWith('/login')) return new Response(JSON.stringify(validSession));
    if (String(url).endsWith('/refresh')) {
      refreshes++;
      return new Response(
        JSON.stringify({
          ...validSession,
          accessToken: 'rotated-access',
          refreshToken: 'rotated-refresh',
        }),
      );
    }
    return new Headers(init?.headers).get('Authorization') === 'Bearer rotated-access'
      ? new Response('{"userId":"synthetic-user"}')
      : new Response('{}', { status: 401 });
  });
  const sessions = new MobileSessions(store, 'https://api.test', fetcher);
  await sessions.login('https://api.test', 'owner@example.invalid', 'synthetic');
  await Promise.all([
    sessions.snapshot.api!.request('/api/v1/session'),
    sessions.snapshot.api!.request('/api/v1/session'),
  ]);
  expect(refreshes).toBe(1);
  expect(sessions.snapshot.session?.accessToken).toBe('rotated-access');
  expect(await store.read()).toContain('rotated-refresh');
});

it.each([401, 403, 404, 409, 500, 503])(
  'retains HTTP %s, route and correlation ID without disclosing problem details or query',
  async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ detail: 'PRIVATE_BODY', correlationId }), { status }),
      );
    const failure = await api(fetcher)
      .request('/api/v1/contracts?search=PRIVATE_QUERY')
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      status,
      requestPath: '/api/v1/contracts?search=PRIVATE_QUERY',
      correlationId,
    });
    for (const message of [errorMessage(failure), contractError(failure)]) {
      expect(message).toContain(`HTTP ${status}`);
      expect(message).toContain('GET /api/v1/contracts');
      expect(message).toContain(correlationId);
      expect(message).not.toContain('PRIVATE');
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it.each(['certificate untrusted PRIVATE', 'Network request failed PRIVATE'])(
  'reports network/TLS failure without pretending to distinguish a native fetch failure (%s)',
  async (detail) => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError(detail));
    const failure = await api(fetcher)
      .json('/api/v1/contracts', {})
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 0, code: 'network_unavailable', method: 'POST' });
    expect(errorMessage(failure)).toContain('chứng chỉ HTTPS');
    expect(errorMessage(failure)).not.toContain('PRIVATE');
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it('bounds a hung API request and never retries an ambiguous mutation', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  );
  const result = api(fetcher)
    .json('/api/v1/contracts', {})
    .catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(15000);
  expect(await result).toMatchObject({ status: 0, code: 'request_timeout' });
  expect(contractError(await result)).toContain('15 giây');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('preserves caller cancellation rather than labeling it as a connectivity failure', async () => {
  const controller = new AbortController();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  );
  const result = api(fetcher)
    .request('/api/v1/contracts', { signal: controller.signal })
    .catch((error: unknown) => error);
  controller.abort();
  expect(await result).toMatchObject({ name: 'AbortError' });
});
it.each([{}, null, { ...validSession, refreshToken: '' }, { ...validSession, roles: 'Owner' }])(
  'rejects malformed successful login responses (%j)',
  async (body) => {
    const store = storage();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body)));
    const sessions = new MobileSessions(store, 'https://api.test', fetcher);
    await expect(
      sessions.login('https://api.test', 'owner@example.invalid', 'synthetic'),
    ).rejects.toMatchObject({ status: 502, code: 'invalid_response' });
    expect(sessions.snapshot.session).toBeNull();
    expect(await store.read()).toBeNull();
  },
);
it('allows login recovery after server failure and keeps tokens solely in secure-store binding', async () => {
  const store = storage();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('{}', { status: 500 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(validSession)));
  const sessions = new MobileSessions(store, 'https://api.test', fetcher);
  await expect(
    sessions.login('https://api.test', 'owner@example.invalid', 'synthetic'),
  ).rejects.toMatchObject({ status: 500 });
  await sessions.login('https://api.test', 'owner@example.invalid', 'synthetic');
  expect(sessions.snapshot.session?.roles).toEqual(['Owner']);
  expect(await store.read()).not.toContain('synthetic-access');
});
it('reports the refresh outage rather than rewriting it as expired authentication', async () => {
  const store = storage();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(validSession)))
    .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ correlationId }), { status: 503 }));
  const sessions = new MobileSessions(store, 'https://api.test', fetcher);
  await sessions.login('https://api.test', 'owner@example.invalid', 'synthetic');
  await expect(sessions.snapshot.api!.request('/api/v1/contracts')).rejects.toMatchObject({
    status: 503,
    requestPath: '/api/v1/auth/refresh',
    correlationId,
  });
  expect(sessions.snapshot.session).toBeNull();
  expect(await store.read()).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('does not let a slow saved-session read overwrite a newer login', async () => {
  let finish!: (value: string | null) => void;
  const store = storage();
  store.read = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(validSession)));
  const sessions = new MobileSessions(store, 'https://api.test', fetcher);
  const restore = sessions.restore();
  await sessions.login('https://api.test', 'owner@example.invalid', 'synthetic');
  finish(JSON.stringify({ base: 'https://old.test', refreshToken: 'old' }));
  await restore;
  expect(sessions.snapshot.session?.accessToken).toBe('synthetic-access');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('requires a healthy HTTPS API for connection checks, without sending credentials', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Healthy'));
  await checkApiConnection('https://api.test', fetcher);
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe('https://api.test/health/ready');
  expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  expect(init?.credentials).toBe('omit');
  await expect(checkApiConnection('http://api.test', fetcher)).rejects.toThrow();
  fetcher.mockResolvedValue(new Response('<html>wrong server</html>'));
  await expect(checkApiConnection('https://api.test', fetcher)).rejects.toMatchObject({
    code: 'invalid_response',
  });
});
it('distinguishes empty, populated, failed and malformed contract list responses', async () => {
  const page = { items: [], page: 1, pageSize: 20, totalCount: 0 };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(page)))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...page,
          totalCount: 1,
          items: [
            {
              id: 'synthetic',
              roomNumber: '101',
              locationName: 'Synthetic',
              status: 'Draft',
              startDate: '2026-10-01',
              endDate: '2027-10-01',
              monthlyRent: '3000000',
            },
          ],
        }),
      ),
    )
    .mockResolvedValueOnce(new Response('{}', { status: 500 }))
    .mockResolvedValueOnce(new Response('{}'));
  const client = contractClient((...args) => api(fetcher).request(...args));
  expect((await client.list()).items).toEqual([]);
  expect((await client.list()).items).toHaveLength(1);
  await expect(client.list()).rejects.toMatchObject({ status: 500 });
  await expect(client.list()).rejects.toMatchObject({
    status: 502,
    problem: { code: 'invalid_response' },
  });
});
it('loads Owner overview from paginated server counts, including real zero counts', async () => {
  const totals = [2, 40, 30, 0];
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async () => new Response(JSON.stringify({ items: [], totalCount: totals.shift() })),
    );
  expect(await loadOwnerOverview(api(fetcher), new AbortController().signal)).toEqual({
    locations: 2,
    rooms: 40,
    occupiedRooms: 30,
    contracts: 0,
  });
  expect(fetcher.mock.calls[2]?.[0]).toContain('roomStatus=2');
  expect(
    fetcher.mock.calls.every(
      ([, init]) => new Headers(init?.headers).get('Authorization') === 'Bearer synthetic-access',
    ),
  ).toBe(true);
});
it.each([500, 403])(
  'rejects an incomplete Owner overview on HTTP %s rather than showing false zeros',
  async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).includes('/rooms')
          ? new Response('{}', { status })
          : new Response('{"items":[],"totalCount":0}'),
      );
    await expect(
      loadOwnerOverview(api(fetcher), new AbortController().signal),
    ).rejects.toBeInstanceOf(MobileApiError);
  },
);
