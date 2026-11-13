import { afterEach, expect, it, vi } from 'vitest';
import { createApiClient } from '../../../../packages/client-core/src/api';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
it.each([undefined, '', 'api', 'unexpected'])(
  'uses the backend when VITE_API_MODE is %s',
  async (mode) => {
    vi.stubEnv('VITE_API_MODE', mode);
    vi.resetModules();
    expect((await import('./config')).isMockMode).toBe(false);
  },
);
it('enables demo only when mock is explicitly configured', async () => {
  vi.stubEnv('VITE_API_MODE', 'mock');
  vi.resetModules();
  expect((await import('./config')).isMockMode).toBe(true);
});

it('routes development business requests through the same-origin proxy', async () => {
  vi.stubEnv('DEV', true);
  vi.stubEnv('VITE_API_MODE', 'api');
  vi.stubEnv('VITE_API_BASE_URL', 'https://localhost:7240');
  const transport = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', transport);
  try {
    const { apiBaseUrl } = await import('./config');
    await createApiClient(apiBaseUrl)('/api/v1/notifications/unread-count');
    expect(transport).toHaveBeenCalledWith(
      '/api/v1/notifications/unread-count',
      expect.any(Object),
    );
    expect((await import('./apiClient')).apiClient.defaults.baseURL).toBe('');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('keeps the configured HTTPS API for production', async () => {
  vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_API_MODE', 'api');
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.invalid');
  expect((await import('./config')).apiBaseUrl).toBe('https://api.example.invalid');
});

it('rejects an insecure production API', async () => {
  vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_API_MODE', 'api');
  vi.stubEnv('VITE_API_BASE_URL', 'http://api.example.invalid');
  await expect(import('./config')).rejects.toThrow('Production API requires HTTPS.');
});
