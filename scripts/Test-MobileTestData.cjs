// Read-only smoke checks against the seeded local Development API. Never log tokens/passwords.
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { X509Certificate } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const accounts = JSON.parse(
  fs
    .readFileSync(path.join(root, '.tools/mobile-test/accounts.json'), 'utf8')
    .replace(/^\uFEFF/, ''),
);
const ca = new X509Certificate(
  fs.readFileSync(path.join(root, '.tools/mobile-tls/root-ca.cer')),
).toString();
const base = new URL(process.argv[2] || 'https://localhost:7240');
const lanIp = fs.readFileSync(path.join(root, '.tools/mobile-tls/lan-ip.txt'), 'utf8').trim();
if (base.protocol !== 'https:' || !['localhost', '127.0.0.1', lanIp].includes(base.hostname)) {
  throw new Error('Use the known local HTTPS Development API.');
}
function request(route, token, method = 'GET', body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request(
      new URL(route, base),
      {
        ca,
        method,
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(data ? { 'Content-Type': 'application/json' } : {}),
          ...extraHeaders,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          let value;
          try {
            value = text ? JSON.parse(text) : null;
          } catch {
            value = null;
          }
          resolve({ status: res.statusCode, value, headers: res.headers });
        });
      },
    );
    req.setTimeout(15000, () => req.destroy(new Error('API timeout')));
    req.on('error', reject);
    req.end(data);
  });
}
const fixture = (n) => `b4040000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let passed = 0;
async function check(label, route, token, validate = () => true) {
  const response = await request(route, token);
  if (response.status !== 200 || !validate(response.value))
    throw new Error(`${label}: HTTP ${response.status}, unexpected response`);
  passed++;
  console.log(`PASS ${label}`);
  return response.value;
}
async function run() {
  await check('readiness (TLS verified)', '/health/ready');
  const sessions = [];
  let cleanupFailed = false;
  try {
    for (const role of ['Owner', 'Staff', 'Tenant']) {
      const response = await request('/api/v1/auth/login', null, 'POST', {
        email: accounts[role.toLowerCase() + 'Email'],
        password: accounts.password,
        device: 'mobile-test-smoke',
      });
      if (
        response.status !== 200 ||
        !response.value?.roles?.includes(role) ||
        !response.value?.accessToken
      )
        throw new Error(`${role} login: HTTP ${response.status}`);
      const session = response.value;
      sessions.push(session);
      passed++;
      console.log(`PASS ${role} login`);
      await check(`${role} session`, '/api/v1/auth/me', session.accessToken, (v) =>
        v.roles.includes(role),
      );
      if (role === 'Owner' || role === 'Staff') {
        await check(`${role} locations`, '/api/v1/capture/locations', session.accessToken, (v) =>
          v.some((r) => r.id === fixture(10)),
        );
        await check(
          `${role} operational tasks`,
          '/api/v1/operational-tasks?page=1&pageSize=20&locationId=' + fixture(10),
          session.accessToken,
          (v) => v.items.length === 3,
        );
        await check(
          `${role} meter tasks`,
          '/api/v1/capture/meter-tasks',
          session.accessToken,
          (v) => v.filter((r) => r.id === fixture(60) || r.id === fixture(61)).length === 2,
        );
      }
      await check(
        `${role} contract`,
        '/api/v1/contracts/' + fixture(40),
        session.accessToken,
        (v) => v.status === 'Active',
      );
      await check(
        `${role} inbox`,
        '/api/v1/notifications?page=1&pageSize=20',
        session.accessToken,
        (v) =>
          v.items.some(
            (r) => r.id === fixture(120 + ['Owner', 'Staff', 'Tenant'].indexOf(role) + 1),
          ),
      );
      if (role === 'Tenant') {
        await check(
          'Tenant invoices',
          '/api/v1/invoices?page=1&pageSize=20',
          session.accessToken,
          (v) =>
            v.items.filter((i) => [fixture(100), fixture(101), fixture(102)].includes(i.id))
              .length === 3,
        );
        await check(
          'Tenant invoice detail',
          '/api/v1/invoices/' + fixture(100),
          session.accessToken,
          (v) => v.lines.length === 3,
        );
        await check(
          'Tenant unpaid balance',
          '/api/v1/invoices/' + fixture(100) + '/payment',
          session.accessToken,
          (v) => v.paymentStatus === 'Unpaid',
        );
        await check(
          'Tenant debts',
          '/api/v1/debts?page=1&pageSize=20',
          session.accessToken,
          (v) => v.items.length >= 2,
        );
        await check(
          'Tenant adjustment list',
          '/api/v1/invoice-adjustments?page=1&pageSize=20&invoiceId=' + fixture(100),
          session.accessToken,
          (v) => Array.isArray(v.items),
        );
        const forbidden = await request('/api/v1/operational-tasks', session.accessToken);
        if (forbidden.status !== 403)
          throw new Error(`Tenant task isolation: HTTP ${forbidden.status}`);
        passed++;
        console.log('PASS Tenant cannot read Staff operational tasks');
        const refreshed = await request('/api/v1/auth/refresh', null, 'POST', {
          refreshToken: session.refreshToken,
        });
        if (refreshed.status !== 200 || !refreshed.value?.accessToken)
          throw new Error(`Refresh: HTTP ${refreshed.status}`);
        Object.assign(session, refreshed.value);
        passed++;
        console.log('PASS Tenant refresh');
      }
    }
    const preflight = await request('/api/v1/auth/login', null, 'OPTIONS', undefined, {
      Origin: 'http://localhost:8081',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    });
    if (preflight.headers['access-control-allow-origin'] !== 'http://localhost:8081')
      throw new Error('Mobile Web CORS not allowed');
    passed++;
    console.log('PASS Mobile Web CORS localhost:8081');
  } finally {
    for (const session of sessions) {
      const response = await request('/api/v1/auth/logout', session.accessToken, 'POST', {});
      if (response.status !== 204) {
        cleanupFailed = true;
        console.error(`Logout: HTTP ${response.status}`);
      }
    }
  }
  if (cleanupFailed) throw new Error('Temporary session cleanup failed');
  console.log(
    `RESULT: ${passed} checks passed; temporary test sessions logged out. No tokens/passwords printed.`,
  );
}
run().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
