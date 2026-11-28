// Only explicit staging/product Metro launches may use the local browser relay.
// Native and release builds always request the configured HTTPS API directly.
export function mobileRequestUrl(base: string, path: string): string {
  const origin = typeof document !== 'undefined' ? globalThis.location?.origin : undefined;
  const prefix =
    process.env.EXPO_PUBLIC_PRODUCT_WEB_PROXY === '1'
      ? '/__bhome_product'
      : process.env.EXPO_PUBLIC_STAGING_WEB_PROXY === '1'
        ? '/__bhome_staging'
        : undefined;
  if (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    prefix &&
    base === process.env.EXPO_PUBLIC_API_BASE_URL &&
    origin &&
    /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/.test(origin) &&
    (path === '/health/ready' || path.startsWith('/api/v1/'))
  )
    return origin + prefix + path;
  return base + path;
}
