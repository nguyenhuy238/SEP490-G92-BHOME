import { afterEach, expect, it, vi } from 'vitest';
import { MobileApi, MobileApiError } from '../lib/api';
const id = '10000000-0000-4000-8000-000000000001';
afterEach(() => vi.useRealTimers());
function setup(delay: number) {
  const transport = vi.fn(
    (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response('{}', { status: 200 })), delay);
        init?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
          },
          { once: true },
        );
      }),
  );
  return {
    transport,
    api: new MobileApi(
      'https://api.example.invalid',
      () => 'synthetic',
      async () => undefined,
      () => {},
      transport,
    ),
  };
}
it.each([
  [`/api/v1/contracts/main-drafts/${id}/documents`, 'POST'],
  [`/api/v1/contracts/main-drafts/${id}/signing-review`, 'POST'],
  [`/api/v1/contracts/main-drafts/${id}/documents/${id}/pages/1`, 'GET'],
])(
  'waits for a slow server conversion without aborting at 15 seconds: %s',
  async (path, method) => {
    vi.useFakeTimers();
    const { api, transport } = setup(20000);
    const result = api.request(path, { method });
    await vi.advanceTimersByTimeAsync(20000);
    await expect(result).resolves.toEqual({});
    expect(transport).toHaveBeenCalledTimes(1);
  },
);
it('still bounds conversion requests to 60 seconds and never replays a timed-out generation', async () => {
  vi.useFakeTimers();
  const { api, transport } = setup(65000);
  const result = api
    .request(`/api/v1/contracts/main-drafts/${id}/documents`, { method: 'POST' })
    .catch((e) => e);
  await vi.advanceTimersByTimeAsync(60000);
  expect(await result).toMatchObject({ code: 'request_timeout' });
  expect(transport).toHaveBeenCalledTimes(1);
});
it('keeps ordinary API requests bounded to 15 seconds', async () => {
  vi.useFakeTimers();
  const { api } = setup(20000);
  const result = api.request('/api/v1/invoices').catch((e) => e);
  await vi.advanceTimersByTimeAsync(15000);
  expect(await result).toBeInstanceOf(MobileApiError);
  expect(await result).toMatchObject({ code: 'request_timeout' });
});
