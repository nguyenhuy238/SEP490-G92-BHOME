import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
const { probeMobileApi } = createRequire(import.meta.url)('../../../scripts/Test-MobileApi.cjs');
const input = {
  address: 'synthetic-pc.local',
  ca: 'synthetic-public-ca',
  expectedAddress: '192.168.1.8',
};

function fixture(body = 'Healthy', statusCode = 200, remoteAddress = '192.168.1.8') {
  const response = Object.assign(new PassThrough(), { statusCode, socket: { remoteAddress } });
  const request = Object.assign(new EventEmitter(), { destroy: vi.fn() });
  const get = vi.fn((_url: URL, _options: object, callback: (value: typeof response) => void) => {
    queueMicrotask(() => {
      callback(response);
      response.end(body);
    });
    return request;
  });
  return { get, request, response };
}
afterEach(() => vi.useRealTimers());

it('requires valid TLS for the expected LAN address and a BHOME readiness body', async () => {
  const { get } = fixture();
  expect(await probeMobileApi(input, get)).toBe(true);
  expect(get).toHaveBeenCalledExactlyOnceWith(
    new URL('https://synthetic-pc.local:7240/health/ready'),
    { ca: 'synthetic-public-ca', rejectUnauthorized: true, family: 4 },
    expect.any(Function),
  );
});
it.each([
  ['Healthy', 200, '10.0.0.8'],
  ['Healthy', 503, '192.168.1.8'],
  ['<html>another server</html>', 200, '192.168.1.8'],
  ['x'.repeat(65), 200, '192.168.1.8'],
])(
  'rejects wrong machine, readiness status or response (%s, %s, %s)',
  async (body, status, address) => {
    expect(await probeMobileApi(input, fixture(body, status, address).get)).toBe(false);
  },
);
it.each(['ENOTFOUND', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID'])(
  'returns failure for %s so the launcher can use its verified LAN IP',
  async (code) => {
    const { request } = fixture();
    const get = vi.fn(() => {
      queueMicrotask(() => request.emit('error', Object.assign(new Error('synthetic'), { code })));
      return request;
    });
    expect(await probeMobileApi(input, get)).toBe(false);
  },
);
it('bounds DNS/connect/TLS/body waiting even if no response ever arrives', async () => {
  vi.useFakeTimers();
  const { request } = fixture();
  const result = probeMobileApi(
    input,
    vi.fn(() => request),
  );
  await vi.advanceTimersByTimeAsync(2500);
  expect(await result).toBe(false);
  expect(request.destroy).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('does not treat a streamed response failure as a healthy API', async () => {
  const { request, response } = fixture();
  const get = vi.fn((_url: URL, _options: object, callback: (value: typeof response) => void) => {
    queueMicrotask(() => {
      callback(response);
      response.emit('error', new Error('synthetic'));
    });
    return request;
  });
  expect(await probeMobileApi(input, get)).toBe(false);
});
