// Only explicit deployed-environment Metro launches may use a local browser relay.
// Native and release builds always request the configured HTTPS API directly.
export function mobileRequestUrl(base: string, path: string): string {
  const origin = typeof document !== 'undefined' ? globalThis.location?.origin : undefined;
  const staging = process.env.EXPO_PUBLIC_STAGING_WEB_PROXY === '1';
  const production = process.env.EXPO_PUBLIC_PRODUCTION_WEB_PROXY === '1';
  if (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    staging !== production &&
    base === process.env.EXPO_PUBLIC_API_BASE_URL &&
    origin &&
    /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/.test(origin) &&
    (path === '/health/ready' || path.startsWith('/api/v1/'))
  ) {
    if (staging && base === 'https://api-staging.103.146.23.157.sslip.io')
      return origin + '/__bhome_staging' + path;
    if (production && base === 'https://api.103.146.23.157.sslip.io')
      return origin + '/__bhome_production' + path;
  }
  return base + path;
}
