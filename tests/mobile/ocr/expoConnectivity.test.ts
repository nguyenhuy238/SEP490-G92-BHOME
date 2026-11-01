import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
const { probeExpoMobile } = createRequire(import.meta.url)('../../../scripts/Test-ExpoMobile.cjs');
const origin = 'http://192.168.1.8:8081';
const manifest = {
  launchAsset: { url: origin + '/entry.bundle?platform=ios' },
  extra: { expoClient: { hostUri: '192.168.1.8:8081' } },
};
function transport(value: unknown = manifest) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('packager-status:running'))
    .mockResolvedValueOnce(new Response(JSON.stringify(value)));
}

it('validates Metro status and the actual iOS manifest, without sending credentials', async () => {
  const fetcher = transport();
  await expect(probeExpoMobile(origin, fetcher)).resolves.toEqual({ ok: true });
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
    origin + '/status',
    origin + '/',
  ]);
  expect(fetcher.mock.calls[1]![1]?.headers).toMatchObject({ 'expo-platform': 'ios' });
  for (const [, init] of fetcher.mock.calls) {
    expect(init?.credentials).toBe('omit');
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  }
});
it.each([
  null,
  {},
  { launchAsset: { url: 'http://localhost:8081/entry.bundle' } },
  { ...manifest, launchAsset: { url: 'http://192.168.99.8:8081/entry.bundle' } },
  { ...manifest, launchAsset: { url: 'http://user:private@192.168.1.8:8081/entry.bundle' } },
  { ...manifest, extra: { expoClient: { hostUri: '192.168.99.8:8081' } } },
])('rejects an invalid/stale manifest instead of declaring Metro ready (%j)', async (value) => {
  expect((await probeExpoMobile(origin, transport(value))).ok).toBe(false);
});
it('does not accept an unrelated HTTP server as Metro', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Healthy'));
  await expect(probeExpoMobile(origin, fetcher)).resolves.toEqual({
    ok: false,
    code: 'metro_not_ready',
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('retains the manifest HTTP failure separately from API readiness', async () => {
  const fetcher = transport();
  fetcher
    .mockReset()
    .mockResolvedValueOnce(new Response('packager-status:running'))
    .mockResolvedValueOnce(new Response('', { status: 500 }));
  await expect(probeExpoMobile(origin, fetcher)).resolves.toEqual({
    ok: false,
    code: 'manifest_http_error',
    status: 500,
  });
});
it('sanitizes a network failure and never reports a device connection', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('PRIVATE_NETWORK_DETAIL'));
  const result = await probeExpoMobile(origin, fetcher);
  expect(result).toEqual({ ok: false, code: 'metro_unavailable_or_invalid_manifest' });
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
