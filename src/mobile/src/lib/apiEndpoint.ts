import { apiBaseUrl } from './api';

export function resolveApiEndpoint({
  development,
  hostUri,
  configuredUrl,
  developmentUrl,
  browserHostname,
}: {
  development: boolean;
  hostUri?: string | null;
  configuredUrl?: string;
  developmentUrl?: string;
  browserHostname?: string;
}): string {
  // Public/staging DNS endpoints remain reachable across Wi-Fi and cellular networks.
  // Local addresses belong to a workstation, including a teammate's copied .local URL.
  const configured = configuredUrl ? apiBaseUrl(configuredUrl) : '';
  if (configured && (!development || !isLocalHost(new URL(configured).hostname))) return configured;
  if (development && developmentUrl && !isLocalHost(new URL(apiBaseUrl(developmentUrl)).hostname))
    return apiBaseUrl(developmentUrl);
  // A local browser can use the workstation certificate's loopback SAN, while
  // Expo Go must retain the launcher's LAN address. Never rewrite public/release APIs.
  if (development && ['localhost', '127.0.0.1', '[::1]'].includes(browserHostname ?? '')) {
    const port = developmentUrl ? new URL(apiBaseUrl(developmentUrl)).port : '7240';
    return apiBaseUrl(`https://localhost${port ? `:${port}` : ''}`);
  }
  if (development && developmentUrl) return apiBaseUrl(developmentUrl);
  // The QR/manifest identifies this developer's Metro server. Never scan the LAN or
  // derive a production API from a development manifest. Only private IPv4 LANs qualify.
  if (development && hostUri) {
    const match = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(hostUri);
    if (match) {
      const parts = match[1]!.split('.').map(Number);
      if (isPrivateIpv4(match[1]!)) return `https://${parts.join('.')}:7240`;
    }
  }
  return configured;
}

function isLocalHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, '');
  return (
    isPrivateIpv4(name) ||
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    name.endsWith('.local') ||
    /^127\./.test(name) ||
    /^169\.254\./.test(name) ||
    name === '[::1]' ||
    /^\[(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/i.test(name)
  );
}

function isPrivateIpv4(host: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  const parts = host.split('.').map(Number);
  return (
    parts.every((part) => part <= 255) &&
    (parts[0] === 10 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31))
  );
}
