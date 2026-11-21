// Build-time validation only. Never import server configuration into a browser bundle.
export function validateWebEnvironment(env: Record<string, string>, build: boolean): URL {
  for (const key of Object.keys(env)) {
    if (
      key.startsWith('VITE_') &&
      /TOKEN|SECRET|PASSWORD|HMAC|CREDENTIAL|API_?KEY|SMTP|CONNECTION_?STRING/i.test(key)
    )
      throw new Error(
        `Remove sensitive frontend variable ${key}; keep credentials on the backend.`,
      );
  }
  if (build && !env.VITE_API_BASE_URL)
    throw new Error('VITE_API_BASE_URL is required for a deploy build.');
  const parse = (value: string): URL => {
    try {
      return new URL(value);
    } catch {
      throw new Error('Invalid frontend URL; value withheld. Supply an absolute HTTPS origin.');
    }
  };
  const api = parse(env.VITE_API_BASE_URL || 'https://localhost:7240');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(api.hostname);
  const temporary =
    /(^|\.)(trycloudflare\.com|ngrok\.io|ngrok-free\.(app|dev)|ngrok\.(app|dev))$/i.test(
      api.hostname,
    );
  if (
    api.username ||
    api.password ||
    api.search ||
    api.hash ||
    api.pathname !== '/' ||
    (api.protocol !== 'https:' && !(api.protocol === 'http:' && loopback && !build)) ||
    (build && (loopback || temporary))
  )
    throw new Error(
      'API URL must be an HTTPS origin without credentials; deploy builds reject loopback and temporary tunnels.',
    );
  if (env.VITE_DEPLOYMENT_ORIGIN) {
    const origin = parse(env.VITE_DEPLOYMENT_ORIGIN);
    if (
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== '/' ||
      origin.origin !== api.origin
    )
      throw new Error(
        'VITE_API_BASE_URL must match VITE_DEPLOYMENT_ORIGIN (same-origin deployment API proxy).',
      );
  }
  if (build && env.VITE_API_MODE === 'mock')
    throw new Error('Deploy builds require VITE_API_MODE=api.');
  const environment = env.VITE_DEPLOYMENT_ENVIRONMENT;
  if (environment) {
    const hosts: Record<string, string[]> = {
      Staging: [
        'api-staging.103.146.23.157.sslip.io',
        'owner-staging.103.146.23.157.sslip.io',
        'public-staging.103.146.23.157.sslip.io',
      ],
      Production: [
        'api.103.146.23.157.sslip.io',
        'owner.103.146.23.157.sslip.io',
        'www.103.146.23.157.sslip.io',
      ],
    };
    if (!hosts[environment]?.includes(api.hostname) || api.port)
      throw new Error('API origin does not belong to VITE_DEPLOYMENT_ENVIRONMENT.');
    if (env.VITE_API_MODE !== 'api')
      throw new Error('A release requires explicit VITE_API_MODE=api.');
  }
  return api;
}
