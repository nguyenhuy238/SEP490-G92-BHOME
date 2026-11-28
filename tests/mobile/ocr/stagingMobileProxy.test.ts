import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mobileRequestUrl } from '../../../src/mobile/src/lib/mobileRequestUrl';

const require = createRequire(import.meta.url);
const https = require('node:https');
const {
  stagingMobileProxy,
  productMobileProxy,
} = require('../../../scripts/StagingMobileProxy.cjs');
const staging = 'https://api-staging.103.146.23.157.sslip.io';
const route = '/api/v1/public/locations';
const product = 'https://api.103.146.23.157.sslip.io';
const environments = [
  { name: 'staging', base: staging, prefix: '/__bhome_staging', proxy: stagingMobileProxy },
  { name: 'product', base: product, prefix: '/__bhome_product', proxy: productMobileProxy },
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(environments)('$name browser transport', ({ name, base, prefix }) => {
  function setup(origin = 'http://localhost:8081', enabled = '1', dev = true) {
    vi.stubEnv('EXPO_PUBLIC_STAGING_WEB_PROXY', name === 'staging' ? enabled : undefined);
    vi.stubEnv('EXPO_PUBLIC_PRODUCT_WEB_PROXY', name === 'product' ? enabled : undefined);
    vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', base);
    vi.stubGlobal('__DEV__', dev);
    vi.stubGlobal('document', {});
    vi.stubGlobal('location', { origin });
  }

  it('uses the Metro relay only for the configured API origin in local development', () => {
    setup();
    expect(mobileRequestUrl(base, route)).toBe('http://localhost:8081' + prefix + route);
    expect(mobileRequestUrl(base, '/health/ready')).toBe(
      'http://localhost:8081' + prefix + '/health/ready',
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
      expect(mobileRequestUrl(base, route)).toBe(base + route);
    },
  );

  it('keeps native Expo Go on the direct HTTPS API', () => {
    setup();
    vi.stubGlobal('document', undefined);
    expect(mobileRequestUrl(base, route)).toBe(base + route);
  });
});

describe.each(environments)('Metro $name relay boundary', ({ base, prefix, proxy }) => {
  function request(overrides = {}, headers = {}) {
    const req = {
      url: prefix + route,
      method: 'GET',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: 'localhost:8081', ...headers },
      ...overrides,
    };
    const res = { writeHead: vi.fn(), end: vi.fn() };
    res.writeHead.mockReturnValue(res);
    const next = vi.fn();
    proxy(req, res, next);
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
    const { res } = request({ url: prefix + '/api/v1/../../private' });
    expect(res.writeHead).toHaveBeenCalledWith(400, { 'Cache-Control': 'no-store' });
  });

  it('forwards only to the fixed environment API without cookies or browser origin', () => {
    const upstream = new PassThrough();
    const forward = vi.spyOn(https, 'request').mockReturnValue(upstream);
    const req = Object.assign(new PassThrough(), {
      url: prefix + route,
      method: 'POST',
      socket: { remoteAddress: '127.0.0.1' },
      headers: {
        host: 'localhost:8081',
        origin: 'http://localhost:8081',
        authorization: 'Bearer synthetic-token',
        cookie: 'synthetic-cookie',
      },
    });
    proxy(req, new PassThrough(), vi.fn());
    expect(forward).toHaveBeenCalledExactlyOnceWith(
      new URL(base + route),
      {
        method: 'POST',
        headers: { authorization: 'Bearer synthetic-token' },
        timeout: 120000,
      },
      expect.any(Function),
    );
    req.destroy();
    upstream.destroy();
  });
});
