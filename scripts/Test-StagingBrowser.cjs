const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const legacy = process.env.BHOME_TEST_STAGING_LEGACY === 'true';
const owner = legacy
  ? 'https://owner-sepay-test.103.146.23.157.sslip.io'
  : 'https://owner-staging.103.146.23.157.sslip.io';
const api = legacy
  ? 'https://api-sepay-test.103.146.23.157.sslip.io'
  : 'https://api-staging.103.146.23.157.sslip.io';
let phase = 'bootstrap';
function classifyFailures(failures) {
  const expected = [],
    unexpected = [];
  for (const failure of failures) {
    if (failure.error === 'net::ERR_ABORTED' && failure.navigation) expected.push(failure);
    else unexpected.push(failure);
  }
  return { expected, unexpected };
}
async function main() {
  const output = path.resolve('.tools/staging-browser');
  fs.mkdirSync(output, { recursive: true });
  // Run on the VPS with a read-only fixture mount; never export credentials over SSH.
  const fixturePath =
    process.env.BHOME_STAGING_BROWSER_FIXTURE_FILE || '/opt/bhome-config/sepay-staging.seed.env';
  const fixture = Object.fromEntries(
    fs
      .readFileSync(fixturePath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.includes('=') && !line.startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  const password = fixture.BHOME_SEPAY_FIXTURE_PASSWORD;
  assert.ok(password, 'Private synthetic fixture is required on the VPS');
  const browser = await chromium.launch({
    executablePath:
      process.env.BHOME_TEST_BROWSER ||
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: process.env.BHOME_TEST_CONTAINER === 'true' ? ['--no-sandbox'] : [],
  });
  const context = await browser.newContext({
    viewport:
      process.env.BHOME_TEST_MOBILE === 'true'
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  const observed = [],
    failures = [],
    consoleErrors = [];
  const pending = new Set();
  const navigationPending = new WeakSet();
  let departingDocument = false;
  const navigate = async (action) => {
    // Include old-document fetches that start between initiating navigation and
    // the new document committing. New-document requests are never exempted.
    for (const request of pending) navigationPending.add(request);
    departingDocument = true;
    try {
      return await action();
    } finally {
      departingDocument = false;
    }
  };
  let accessToken;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) departingDocument = false;
  });
  page.on('request', (request) => {
    pending.add(request);
    if (departingDocument && !request.isNavigationRequest()) navigationPending.add(request);
  });
  page.on('requestfinished', (request) => pending.delete(request));
  page.on('response', async (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/'))
      observed.push({ origin: url.origin, path: url.pathname, status: r.status() });
    if (url.pathname === '/api/v1/auth/login' && r.status() === 200)
      accessToken = (await r.json()).accessToken;
  });
  page.on('requestfailed', (r) => {
    pending.delete(r);
    const failure = {
      method: r.method(),
      origin: new URL(r.url()).origin,
      path: new URL(r.url()).pathname,
      error: r.failure()?.errorText,
      navigation: navigationPending.has(r),
    };
    failures.push(failure);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && /cors|mixed content|certificate/i.test(m.text()))
      consoleErrors.push('Browser transport error');
  });
  try {
    phase = 'HTTPS and login';
    const navigation = await navigate(() => page.goto(owner + '/login'));
    assert.equal(navigation.status(), 200);
    const security = await navigation.securityDetails();
    assert.ok(security.protocol.startsWith('TLS'), 'HTTPS required');
    await page.screenshot({ path: path.join(output, 'staging-login.png'), fullPage: true });
    await page.locator('#login-identifier').fill('owner.sepay.test@example.invalid');
    await page.locator('#login-password').fill(password);
    await page.locator('button[type=submit]').click();
    await page.waitForURL('**/dashboard');
    await page.waitForLoadState('networkidle');
    phase = 'refresh cookie attributes';
    const cookie = (await context.cookies(api + '/api/v1/auth')).find(
      (c) => c.name === '__Secure-bhome-refresh',
    );
    if (!cookie)
      console.log(
        JSON.stringify({
          diagnostic: 'No refresh cookie for the API origin',
          cookies: (await context.cookies()).map(
            ({ name, domain, secure, httpOnly, sameSite }) => ({
              name,
              domain,
              secure,
              httpOnly,
              sameSite,
            }),
          ),
          observed,
        }),
      );
    assert.ok(
      cookie?.httpOnly && cookie.secure && cookie.sameSite === 'Strict',
      'Refresh cookie flags',
    );
    const before = cookie.value;
    phase = 'refresh rotation after reload';
    const refreshed = page.waitForResponse(
      (r) => r.url() === api + '/api/v1/auth/refresh' && r.status() === 200,
    );
    await navigate(() => page.reload());
    await refreshed;
    await page.waitForURL('**/dashboard');
    await page.waitForLoadState('networkidle');
    assert.ok(
      (await context.cookies(api + '/api/v1/auth')).find((c) => c.name === '__Secure-bhome-refresh')
        ?.value !== before,
      'Refresh rotation',
    );
    await navigate(() => page.goto(owner + '/account/profile'));
    phase = 'profile and Sandbox context';
    await page.getByRole('heading', { name: 'Hồ sơ tài khoản', exact: true }).waitFor();
    await page.waitForLoadState('networkidle');
    const testMode = await page.evaluate(
      async ({ api, token }) => {
        const r = await fetch(api + '/api/v1/integrations/sepay/testing-context', {
          headers: { Authorization: 'Bearer ' + token },
        });
        return { status: r.status, body: await r.json() };
      },
      { api, token: accessToken },
    );
    assert.equal(testMode.status, 200);
    assert.equal(testMode.body.mode, 'Test');
    phase = 'cross-environment token rejection';
    const production = await fetch('https://api.103.146.23.157.sslip.io/api/v1/auth/me', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    assert.equal(production.status, 401, 'Staging token rejected by Production');
    assert.ok(
      observed.every((r) => r.origin === api),
      'Every browser API request must target Staging',
    );
    assert.deepEqual(classifyFailures(failures).unexpected, [], 'Browser request failures');
    assert.deepEqual(consoleErrors, [], 'CORS/mixed-content errors');
    phase = 'logout';
    const logout = await page.evaluate(
      async ({ api, token }) => {
        const r = await fetch(api + '/api/v1/auth/logout', {
          method: 'POST',
          credentials: 'include',
          headers: {
            Authorization: 'Bearer ' + token,
            'X-BHome-Client': 'web',
            'Content-Type': 'application/json',
          },
          body: '{}',
        });
        return r.status;
      },
      { api, token: accessToken },
    );
    assert.equal(logout, 204, 'Logout must revoke the synthetic browser session');
    accessToken = undefined;
    await navigate(() => page.reload());
    await page.waitForURL('**/login');
    await page.waitForLoadState('networkidle');
    const classified = classifyFailures(failures);
    assert.deepEqual(classified.unexpected, [], 'Browser request failures after logout');
    const summary = {
      result: 'PASS',
      owner,
      api,
      tls: { protocol: security.protocol, issuer: security.issuer, validTo: security.validTo },
      login: true,
      refreshRotation: true,
      nestedProfile: true,
      logout: 204,
      secureHttpOnlyStrict: true,
      sepayTestContext: 200,
      productionRejectsStageToken: 401,
      requests: observed,
      failedRequests: classified.unexpected.length,
      intentionalCancellations: classified.expected,
      transportErrors: consoleErrors.length,
    };
    fs.writeFileSync(path.join(output, 'browser-evidence.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    try {
      // Revoke only the synthetic session created by this test if an assertion
      // fails before the normal logout step; keep credentials on the VPS.
      if (accessToken)
        await context.request.post(api + '/api/v1/auth/logout', {
          headers: {
            Authorization: 'Bearer ' + accessToken,
            Origin: owner,
            'X-BHome-Client': 'web',
          },
          data: {},
        });
    } finally {
      await browser.close();
    }
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(
      'Browser smoke FAILED at ' +
        phase +
        '; error type: ' +
        e.name +
        '. ' +
        (e.name === 'AssertionError' ? e.message : 'Credentials and raw errors withheld.'),
    );
    process.exitCode = 1;
  });
module.exports = { classifyFailures };
