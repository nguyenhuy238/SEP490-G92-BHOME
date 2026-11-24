const https = require('node:https');

const STAGING_ORIGIN = 'https://api-staging.103.146.23.157.sslip.io';
const PREFIX = '/__bhome_staging';
const requestHeaders = [
  'accept',
  'authorization',
  'content-type',
  'content-length',
  'idempotency-key',
  'x-correlation-id',
];
const responseHeaders = [
  'content-type',
  'content-length',
  'content-encoding',
  'content-disposition',
  'x-correlation-id',
  'retry-after',
];

function selectHeaders(headers, names) {
  return Object.fromEntries(
    names.filter((name) => headers[name] !== undefined).map((name) => [name, headers[name]]),
  );
}

// A fixed-target development proxy, available only to a browser on this PC.
// Never forward cookies, Origin, arbitrary hosts, or redirect credentials.
function stagingProxy(req, res, next, request = https.request) {
  if (!req.url?.startsWith(PREFIX + '/')) return next();
  const fail = (status) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(status, { 'Cache-Control': 'no-store' });
    res.end();
  };
  const host = req.headers.host ?? '';
  const origin = req.headers.origin;
  if (
    !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host) ||
    !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) ||
    (origin && origin !== `http://${host}` && origin !== `https://${host}`) ||
    (req.headers['sec-fetch-site'] &&
      !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) ||
    req.headers['sec-fetch-mode'] === 'navigate'
  )
    return fail(403);
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return fail(405);
  const path = req.url.slice(PREFIX.length);
  if (!path.startsWith('/api/v1/') || path.includes('\\') || path.includes('#')) return fail(400);
  const target = new URL(path, STAGING_ORIGIN);
  if (target.origin !== STAGING_ORIGIN || !target.pathname.startsWith('/api/v1/')) return fail(400);
  const upstream = request(
    target,
    { method: req.method, headers: selectHeaders(req.headers, requestHeaders), timeout: 120000 },
    (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        return fail(502);
      }
      res.writeHead(response.statusCode ?? 502, {
        ...selectHeaders(response.headers, responseHeaders),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      });
      response.on('error', () => res.destroy());
      response.pipe(res);
    },
  );
  upstream.on('timeout', () => upstream.destroy());
  upstream.on('error', () => fail(502));
  res.on('close', () => {
    if (!res.writableFinished) upstream.destroy();
  });
  req.on('error', () => upstream.destroy());
  req.pipe(upstream);
}

module.exports = { STAGING_ORIGIN, stagingProxy };
