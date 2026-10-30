export function getApiBaseUrl(value: string | undefined, development: boolean): string {
  if (!value && !development) throw new Error('VITE_API_BASE_URL is required.');
  const url = new URL(value || 'https://localhost:7240');
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported API protocol.');
  if (!development && url.protocol !== 'https:') throw new Error('Production API requires HTTPS.');
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Invalid API base URL.');
  return url.toString().replace(/\/$/, '');
}
