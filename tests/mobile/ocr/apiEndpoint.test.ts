import { expect, it, vi } from 'vitest';
import { resolveApiEndpoint } from '../../../src/mobile/src/lib/apiEndpoint';
import { MobileSessions } from '../../../src/mobile/src/lib/sessions';

it.each([
  'https://teammate-pc.local:7240',
  'https://TEAMMATE-PC.LOCAL.:7240',
  'https://localhost:7240',
  'https://api.localhost:7240',
  'https://127.0.0.1:7240',
  'https://127.0.0.2:7240',
  'https://169.254.1.2:7240',
  'https://[::1]:7240',
  'https://[fd12:3456::1]:7240',
  'https://[fc00::1]:7240',
  'https://[fe80::1]:7240',
])('does not reuse another workstation local configuration %s', (configuredUrl) => {
  expect(
    resolveApiEndpoint({
      development: true,
      hostUri: '192.168.1.8:8081',
      configuredUrl,
      developmentUrl: 'https://current-pc.local:7240',
    }),
  ).toBe('https://current-pc.local:7240');
  expect(
    resolveApiEndpoint({ development: true, hostUri: '192.168.1.8:8081', configuredUrl }),
  ).toBe('https://192.168.1.8:7240');
  expect(resolveApiEndpoint({ development: false, configuredUrl })).toBe(
    new URL(configuredUrl).origin,
  );
});

it('uses each developer launcher URL even if their Metro port or computer name is the same', () => {
  expect(
    resolveApiEndpoint({
      development: true,
      hostUri: '192.168.1.8:8081',
      developmentUrl: 'https://192.168.1.8:7240',
      configuredUrl: 'https://other-pc.local:7240',
    }),
  ).toBe('https://192.168.1.8:7240');
  expect(
    resolveApiEndpoint({
      development: true,
      hostUri: '10.0.0.8:8081',
      developmentUrl: 'https://10.0.0.8:7240',
      configuredUrl: 'https://other-pc.local:7240',
    }),
  ).toBe('https://10.0.0.8:7240');
});

it('does not send a saved refresh token between computers with identical local hostnames', async () => {
  let saved: string | null = JSON.stringify({
    base: 'https://same-name.local:7240',
    refreshToken: 'synthetic-a',
    serverId: 'ca-a',
  });
  const transport = vi.fn<typeof fetch>();
  const manager = new MobileSessions(
    {
      read: async () => saved,
      write: async (value) => {
        saved = value;
      },
      remove: async () => {
        saved = null;
      },
    },
    'https://same-name.local:7240',
    transport,
    'ca-b',
  );
  await manager.restore();
  expect(transport).not.toHaveBeenCalled();
  expect(saved).toBeNull();
});

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
      developmentUrl: 'https://synthetic-pc.local:7240',
      configuredUrl: 'https://api.example.invalid',
    }),
  ).toBe('https://api.example.invalid');
});
it('uses the stable development hostname across LAN address changes', () => {
  for (const hostUri of ['192.168.1.2:8081', '10.33.59.31:8081']) {
    expect(
      resolveApiEndpoint({
        development: true,
        hostUri,
        configuredUrl: 'https://192.168.0.106:7240',
        developmentUrl: 'https://synthetic-pc.local:7240',
      }),
    ).toBe('https://synthetic-pc.local:7240');
  }
});
it('honors an explicit public HTTPS API even when Expo is served from a private LAN', () => {
  expect(
    resolveApiEndpoint({
      development: true,
      hostUri: '192.168.1.2:8081',
      developmentUrl: 'https://synthetic-pc.local:7240',
      configuredUrl: 'https://api.example.invalid',
    }),
  ).toBe('https://api.example.invalid');
});
it('does not infer an API or disable TLS from an Expo tunnel', () => {
  expect(
    resolveApiEndpoint({
      development: true,
      hostUri: 'synthetic.exp.direct:8081',
      configuredUrl: 'https://api.example.invalid',
    }),
  ).toBe('https://api.example.invalid');
  expect(() =>
    resolveApiEndpoint({ development: true, developmentUrl: 'http://synthetic-pc.local:7240' }),
  ).toThrow();
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
