export function getApiBaseUrl(value: string | undefined, development: boolean): string {
  if (!value) throw new Error('VITE_API_BASE_URL is required.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid API base URL; value withheld.');
  }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported API protocol.');
  if (!development && url.protocol !== 'https:') throw new Error('Production API requires HTTPS.');
  if (
    !development &&
    (url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]' ||
      /(^|\.)(trycloudflare\.com|ngrok\.io|ngrok-free\.(app|dev)|ngrok\.(app|dev))$/i.test(
        url.hostname,
      ))
  )
    throw new Error('Deploy API cannot use loopback or temporary tunnels.');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Invalid API base URL.');
  return url.toString().replace(/\/$/, '');
}
