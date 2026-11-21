// Read-only Metro probe. A desktop PASS is never evidence of phone reachability.
async function probeExpoMobile(base, transport = fetch) {
  try {
    const origin = new URL(base);
    if (
      origin.protocol !== 'http:' ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      return { ok: false, code: 'invalid_metro_origin' };
    const get = (path, headers = {}) =>
      transport(new URL(path, origin), {
        headers,
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
      });
    const status = await get('/status');
    if (!status.ok || (await status.text()).trim() !== 'packager-status:running')
      return { ok: false, code: 'metro_not_ready' };
    const response = await get('/', {
      accept: 'application/expo+json',
      'expo-platform': 'ios',
      'expo-protocol-version': '1',
    });
    if (!response.ok) return { ok: false, code: 'manifest_http_error', status: response.status };
    const manifest = await response.json();
    const bundle = new URL(manifest.launchAsset.url);
    if (
      manifest.extra?.expoClient?.hostUri !== origin.host ||
      bundle.origin !== origin.origin ||
      bundle.username ||
      bundle.password
    )
      return { ok: false, code: 'manifest_wrong_host' };
    return { ok: true };
  } catch {
    return { ok: false, code: 'metro_unavailable_or_invalid_manifest' };
  }
}

module.exports = { probeExpoMobile };
if (require.main === module) {
  const [address, port] = process.argv.slice(2);
  probeExpoMobile(`http://${address}:${port}`).then((result) => process.exit(result.ok ? 0 : 1));
}
