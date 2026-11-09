import { afterEach, expect, it, vi } from 'vitest';
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
