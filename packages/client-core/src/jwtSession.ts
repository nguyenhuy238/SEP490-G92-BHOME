import type { Role } from './roles';

export interface TokenSession {
  userId: string;
  roles: Role[];
  accessToken: string;
  sessionId?: string;
  expiresAt?: string;
}

export interface AuthTokenResponse {
  accessToken: string;
  refreshToken?: string | null;
}

const supportedRoles = new Set<Role>(['Owner', 'Staff', 'Tenant']);

function decodeBase64Url(value: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of normalized.replace(/=+$/, '')) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid access token');
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function sessionFromTokenResponse(
  value: unknown,
  requireRefreshToken = false,
): TokenSession & AuthTokenResponse {
  if (!value || typeof value !== 'object') throw new Error('Invalid session');
  const response = value as Record<string, unknown>;
  if (typeof response.accessToken !== 'string' || !response.accessToken.trim())
    throw new Error('Invalid session');
  if (
    requireRefreshToken &&
    (typeof response.refreshToken !== 'string' || !response.refreshToken.trim())
  )
    throw new Error('Invalid session');

  const parts = response.accessToken.split('.');
  let payload: Record<string, unknown>;
  if (parts.length === 3) {
    payload = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
  } else {
    // Temporary compatibility for mocked/older API responses during the contract rollout.
    if (!Array.isArray(response.roles)) throw new Error('Invalid session');
    payload = { sub: response.userId, role: response.roles, sid: response.sessionId };
  }
  const rawRoles = typeof payload.role === 'string' ? [payload.role] : payload.role;
  if (
    typeof payload.sub !== 'string' ||
    !payload.sub.trim() ||
    !Array.isArray(rawRoles) ||
    !rawRoles.length ||
    !rawRoles.every(
      (role): role is Role => typeof role === 'string' && supportedRoles.has(role as Role),
    )
  )
    throw new Error('Invalid session');

  return {
    userId: payload.sub,
    roles: rawRoles,
    accessToken: response.accessToken,
    ...(typeof response.refreshToken === 'string' ? { refreshToken: response.refreshToken } : {}),
    ...(typeof payload.sid === 'string' ? { sessionId: payload.sid } : {}),
    ...(typeof payload.exp === 'number'
      ? { expiresAt: new Date(payload.exp * 1000).toISOString() }
      : {}),
  };
}
