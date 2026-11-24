const https = require('node:https');
const { STAGING_API_URL } = require('./Start-StagingMobile.cjs');

const prefix = '/__bhome_staging';
const requestHeaders = [
  'accept',
  'authorization',
  'content-type',
  'content-length',
  'idempotency-key',
  'if-match',
  'if-none-match',
  'range',
];
const responseHeaders = [
  'content-type',
  'content-length',
  'content-disposition',
  'content-encoding',
  'x-correlation-id',
  'etag',
  'retry-after',
  'content-range',
];

function stagingMobileProxy(req, res, next) {
  if (!req.url?.startsWith(prefix + '/')) return next();
  const fail = (status) => res.writeHead(status, { 'Cache-Control': 'no-store' }).end();
  // Metro is reachable on LAN for Expo Go, but its staging relay is loopback-only.
  const peer = req.socket.remoteAddress;
  const host = req.headers.host;
  if (
    !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) ||
    !/^(localhost|127\.0\.0\.1):\d{1,5}$/.test(host ?? '') ||
    (req.headers.origin && req.headers.origin !== `http://${host}`) ||
    ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])
  )
    return fail(403);
  const route = req.url.slice(prefix.length);
  if (route === '/health/ready' && req.method === 'GET') return fail(404);
  if (
    !route.startsWith('/api/v1/') ||
    !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
  )
    return fail(404);
  if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== `http://${host}`)
    return fail(403);
  let target;
  try {
    target = new URL(route, STAGING_API_URL);
  } catch {
    return fail(400);
  }
  if (target.origin !== STAGING_API_URL || !target.pathname.startsWith('/api/v1/'))
    return fail(400);

  const headers = Object.fromEntries(
    requestHeaders
      .filter((key) => req.headers[key] !== undefined)
      .map((key) => [key, req.headers[key]]),
  );
  // No cookies, forwarded identity, custom auth mode or browser Origin are relayed.
  // The remote API still validates every bearer token and permission.
  const upstream = https.request(
    target,
    { method: req.method, headers, timeout: 120000 },
    (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.statusCode !== 304) {
        response.resume();
        return fail(502);
      }
      const allowed = Object.fromEntries(
        responseHeaders
          .filter((key) => response.headers[key] !== undefined)
          .map((key) => [key, response.headers[key]]),
      );
      res.writeHead(response.statusCode, {
        ...allowed,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.on('error', () => res.destroy());
      response.pipe(res);
    },
  );
  upstream.on('timeout', () => upstream.destroy());
  upstream.on('error', () => (res.headersSent ? res.destroy() : fail(502)));
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}

module.exports = { stagingMobileProxy };
