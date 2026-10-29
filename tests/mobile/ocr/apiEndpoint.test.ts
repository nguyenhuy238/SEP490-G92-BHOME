import { expect, it, vi } from 'vitest';
import { resolveApiEndpoint } from '../../../src/mobile/src/lib/apiEndpoint';
import { MobileSessions } from '../../../src/mobile/src/lib/sessions';

it.each(['192.168.1.20', '10.33.59.31', '172.16.0.2', '172.31.255.2'])(
  'uses the current developer Metro host %s instead of a stale configured IP',
  (address) => {
    expect(
      resolveApiEndpoint({
        development: true,
        hostUri: `${address}:8082`,
        configuredUrl: 'https://192.168.0.106:7240',
      }),
    ).toBe(`https://${address}:7240`);
  },
);
it('does not use a development host in a release build', () => {
  expect(
    resolveApiEndpoint({
      development: false,
      hostUri: '10.0.0.2:8081',
      configuredUrl: 'https://api.example.invalid',
    }),
  ).toBe('https://api.example.invalid');
});
it.each([
  undefined,
  'localhost:8081',
  '127.0.0.1:8081',
  '169.254.1.2:8081',
  '8.8.8.8:8081',
  '172.32.0.2:8081',
  '192.168.999.1:8081',
  'user@192.168.1.2:8081',
  '192.168.1.2:8081/path',
  '192.168.1.2:8081?password=x',
  'https://192.168.1.2:8081',
  'remote.exp.direct:8081',
])('does not infer a LAN API from an unsupported or unsafe host %s', (hostUri) => {
  expect(resolveApiEndpoint({ development: true, hostUri })).toBe('');
});
it('retains HTTPS validation for explicitly configured standalone endpoints', () => {
  expect(() =>
    resolveApiEndpoint({ development: false, configuredUrl: 'http://api.example.invalid' }),
  ).toThrow();
});
it('requires login again after switching developers without sending the old refresh token', async () => {
  const oldBase = resolveApiEndpoint({ development: true, hostUri: '192.168.1.2:8081' });
  const newBase = resolveApiEndpoint({ development: true, hostUri: '10.0.0.2:8081' });
  let encoded: string | null = JSON.stringify({ base: oldBase, refreshToken: 'synthetic-old' });
  const transport = vi.fn<typeof fetch>();
  const manager = new MobileSessions(
    {
      read: async () => encoded,
      write: async (value) => {
        encoded = value;
      },
      remove: async () => {
        encoded = null;
      },
    },
    newBase,
    transport,
  );
  await manager.restore();
  expect(transport).not.toHaveBeenCalled();
  expect(encoded).toBeNull();
  expect(manager.snapshot).toMatchObject({ baseUrl: newBase, ready: true, session: null });
});
