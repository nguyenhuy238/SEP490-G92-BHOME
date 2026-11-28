import { afterEach, expect, it, vi } from 'vitest';
import { MobileApi, identityOcrRequestTimeoutMilliseconds } from '../lib/api';

const id = '10000000-0000-4000-8000-000000000001';
afterEach(() => vi.useRealTimers());

function setup(delay: number) {
  const transport = vi.fn(
    (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response('{}')), delay);
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

it.each(['front', 'back'])('allows a slow CCCD upload and response for %s', async (face) => {
  vi.useFakeTimers();
  const { api, transport } = setup(25000);
  const result = api.image(
    `/api/v1/ocr/identity/${id}/${face}`,
    new Uint8Array([1]),
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(25000);
  await expect(result).resolves.toEqual({});
  expect(transport).toHaveBeenCalledOnce();
});

it('bounds identity upload/response and does not repeat a timed-out POST', async () => {
  vi.useFakeTimers();
  const { api, transport } = setup(60000);
  const result = api
    .image(`/api/v1/ocr/identity/${id}/front`, new Uint8Array([1]), new AbortController().signal)
    .catch((error) => error);
  await vi.advanceTimersByTimeAsync(identityOcrRequestTimeoutMilliseconds);
  expect(await result).toMatchObject({ code: 'request_timeout' });
  expect(transport).toHaveBeenCalledOnce();
});

it('preserves the caller cancellation and ordinary meter OCR timeout', async () => {
  vi.useFakeTimers();
  const { api, transport } = setup(60000);
  const controller = new AbortController();
  const cancelled = api
    .image(`/api/v1/ocr/identity/${id}/front`, new Uint8Array([1]), controller.signal)
    .catch((error) => error);
  controller.abort();
  expect(await cancelled).toMatchObject({ name: 'AbortError' });
  const meter = api
    .image(
      '/api/v1/ocr/diagnostics/water-mechanical',
      new Uint8Array([1]),
      new AbortController().signal,
    )
    .catch((error) => error);
  await vi.advanceTimersByTimeAsync(15000);
  expect(await meter).toMatchObject({ code: 'request_timeout' });
  expect(transport).toHaveBeenCalledTimes(2);
});
