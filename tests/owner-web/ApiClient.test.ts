import { createApiClient, ApiError } from '@bhome/client-core/api.ts';
import { getApiBaseUrl } from '@bhome/client-core/config.ts';
import { vi } from 'vitest';

it('clears the session on a 401 and preserves correlation metadata', async () => {
  const clear = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ correlationId: 'request-id' }), {
        status: 401,
        headers: { 'Content-Type': 'application/problem+json' },
      }),
    ),
  );
  const api = createApiClient('https://localhost:7240', () => 'test-token', clear);
  await expect(api('/api/v1/session')).rejects.toMatchObject({
    status: 401,
    problem: { correlationId: 'request-id' },
  });
  expect(clear).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});
it('rejects unsafe paths before attaching tokens', async () => {
  await expect(
    createApiClient('https://example.com')('https://other.example/api'),
  ).rejects.toThrow();
});
it('requires HTTPS and explicit configuration in production', () => {
  expect(() => getApiBaseUrl(undefined, false)).toThrow();
  expect(() => getApiBaseUrl('http://api.example.com', false)).toThrow();
});
it('uses a safe user-facing message for transport errors', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private transport detail')));
  await expect(createApiClient('https://example.com')('/api/v1/session')).rejects.toBeInstanceOf(
    ApiError,
  );
  vi.unstubAllGlobals();
});
