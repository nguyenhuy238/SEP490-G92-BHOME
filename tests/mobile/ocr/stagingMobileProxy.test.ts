import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mobileRequestUrl } from '../../../src/mobile/src/lib/mobileRequestUrl';

const { stagingMobileProxy } = createRequire(import.meta.url)(
  '../../../scripts/StagingMobileProxy.cjs',
);
const staging = 'https://api-staging.103.146.23.157.sslip.io';
const route = '/api/v1/public/locations';
const proxyRoute = '/__bhome_staging' + route;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('staging browser transport', () => {
  function setup(origin = 'http://localhost:8081', enabled = '1', dev = true) {
    vi.stubEnv('EXPO_PUBLIC_STAGING_WEB_PROXY', enabled);
    vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', staging);
    vi.stubGlobal('__DEV__', dev);
    vi.stubGlobal('document', {});
    vi.stubGlobal('location', { origin });
  }

  it('uses the Metro relay only for the configured staging origin in local development', () => {
    setup();
    expect(mobileRequestUrl(staging, route)).toBe('http://localhost:8081' + proxyRoute);
    expect(mobileRequestUrl(staging, '/health/ready')).toBe(
      'http://localhost:8081/__bhome_staging/health/ready',
    );
    expect(mobileRequestUrl('https://other.example.invalid', route)).toBe(
      'https://other.example.invalid' + route,
    );
  });

  it.each([
    ['https://example.invalid', '1', true],
    ['http://192.168.2.102:8081', '1', true],
    ['http://localhost:8081', '0', true],
    ['http://localhost:8081', '1', false],
  ])(
    'keeps the direct HTTPS API outside the explicit loopback dev mode',
    (origin, enabled, dev) => {
      setup(origin, enabled, dev);
      expect(mobileRequestUrl(staging, route)).toBe(staging + route);
    },
  );

  it('keeps native Expo Go on the direct HTTPS API', () => {
    setup();
    vi.stubGlobal('document', undefined);
    expect(mobileRequestUrl(staging, route)).toBe(staging + route);
  });
});

describe('Metro staging relay boundary', () => {
  function request(overrides = {}, headers = {}) {
    const req = {
      url: proxyRoute,
      method: 'GET',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: 'localhost:8081', ...headers },
      ...overrides,
    };
    const res = { writeHead: vi.fn(), end: vi.fn() };
    res.writeHead.mockReturnValue(res);
    const next = vi.fn();
    stagingMobileProxy(req, res, next);
    return { res, next };
  }

  it('leaves Metro bundle and manifest routes intact', () => {
    const { next, res } = request({ url: '/status' });
    expect(next).toHaveBeenCalledOnce();
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  it.each([
    [{ socket: { remoteAddress: '192.168.2.103' } }, {}],
    [{}, { host: 'example.invalid:8081' }],
    [{}, { origin: 'http://localhost:9999' }],
    [{}, { 'sec-fetch-site': 'cross-site' }],
    [{ method: 'POST' }, {}],
  ])('rejects non-local or cross-origin requests before forwarding', (overrides, headers) => {
    const { res } = request(overrides, headers);
    expect(res.writeHead).toHaveBeenCalledWith(403, { 'Cache-Control': 'no-store' });
  });

  it('rejects a normalized path outside the versioned API', () => {
    const { res } = request({ url: '/__bhome_staging/api/v1/../../private' });
    expect(res.writeHead).toHaveBeenCalledWith(400, { 'Cache-Control': 'no-store' });
  });
});
