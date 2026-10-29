import { apiBaseUrl } from './api';

export function resolveApiEndpoint({
  development,
  hostUri,
  configuredUrl,
}: {
  development: boolean;
  hostUri?: string | null;
  configuredUrl?: string;
}): string {
  // The QR/manifest identifies this developer's Metro server. Never scan the LAN or
  // derive a production API from a development manifest. Only private IPv4 LANs qualify.
  if (development && hostUri) {
    const match = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(hostUri);
    if (match) {
      const parts = match[1]!.split('.').map(Number);
      if (
        parts.every((part) => part <= 255) &&
        (parts[0] === 10 ||
          (parts[0] === 192 && parts[1] === 168) ||
          (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31))
      )
        return `https://${parts.join('.')}:7240`;
    }
  }
  return configuredUrl ? apiBaseUrl(configuredUrl) : '';
}
