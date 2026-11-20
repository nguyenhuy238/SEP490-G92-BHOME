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
(async () => {
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
  let accessToken;
  page.on('response', async (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/'))
      observed.push({ origin: url.origin, path: url.pathname, status: r.status() });
    if (url.pathname === '/api/v1/auth/login' && r.status() === 200)
      accessToken = (await r.json()).accessToken;
  });
  page.on('requestfailed', (r) =>
    failures.push({
      origin: new URL(r.url()).origin,
      path: new URL(r.url()).pathname,
      error: r.failure()?.errorText,
    }),
  );
  page.on('console', (m) => {
    if (m.type() === 'error' && /cors|mixed content|certificate/i.test(m.text()))
      consoleErrors.push('Browser transport error');
  });
  try {
    phase = 'HTTPS and login';
    const navigation = await page.goto(owner + '/login');
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
    await page.reload();
    await refreshed;
    await page.waitForURL('**/dashboard');
    await page.waitForLoadState('networkidle');
    assert.ok(
      (await context.cookies(api + '/api/v1/auth')).find((c) => c.name === '__Secure-bhome-refresh')
        ?.value !== before,
      'Refresh rotation',
    );
    await page.goto(owner + '/account/profile');
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
    assert.deepEqual(failures, [], 'Browser request failures');
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
    await page.reload();
    await page.waitForURL('**/login');
    await page.waitForLoadState('networkidle');
    assert.deepEqual(failures, [], 'Browser request failures after logout');
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
      failedRequests: failures.length,
      transportErrors: consoleErrors.length,
    };
    fs.writeFileSync(path.join(output, 'browser-evidence.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
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
