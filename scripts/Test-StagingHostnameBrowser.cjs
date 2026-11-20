// Execute on the VPS: credentials and saved browser sessions never leave it.
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const phase = process.env.BHOME_MIGRATION_PHASE || 'after';
const directory = process.env.BHOME_MIGRATION_EVIDENCE || '/evidence';
const owner = 'https://owner-staging.103.146.23.157.sslip.io';
const api = 'https://api-staging.103.146.23.157.sslip.io';
const publicOrigin = 'https://public-staging.103.146.23.157.sslip.io';
const oldOwner = 'https://owner-sepay-test.103.146.23.157.sslip.io';
const oldApi = 'https://api-sepay-test.103.146.23.157.sslip.io';
let step = 'initialize';
(async () => {
  fs.mkdirSync(directory, { recursive: true });
  const privateState = path.join(directory, 'legacy-storage.private.json');
  const fixturePath = process.env.BHOME_STAGING_BROWSER_FIXTURE_FILE || '/fixture.env';
  const fixture = Object.fromEntries(
    fs
      .readFileSync(fixturePath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.includes('=') && !line.startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  const password = fixture.BHOME_SEPAY_FIXTURE_PASSWORD;
  assert.ok(password);
  const browser = await chromium.launch({
    executablePath: process.env.BHOME_TEST_BROWSER || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox'],
  });
  const results = [];
  const login = async (page, origin) => {
    await page.goto(origin + '/login');
    await page.locator('#login-identifier').fill('owner.sepay.test@example.invalid');
    await page.locator('#login-password').fill(password);
    await page.locator('button[type=submit]').click();
    await page.waitForURL('**/dashboard');
    await page.waitForLoadState('networkidle');
  };
  try {
    if (phase === 'before') {
      step = 'prepare pre-migration legacy session';
      const context = await browser.newContext();
      const page = await context.newPage();
      await login(page, oldOwner);
      await context.storageState({ path: privateState });
      fs.chmodSync(privateState, 0o600);
      results.push({ phase, result: 'PASS', legacyAuthenticatedSessionPreparedOnVps: true });
      await context.close();
    } else {
      step = 'preserve pre-migration legacy session';
      const context = await browser.newContext({ storageState: privateState });
      const page = await context.newPage();
      const refreshed = page.waitForResponse(
        (r) => r.url() === oldApi + '/api/v1/auth/refresh' && r.status() === 200,
      );
      await page.goto(oldOwner + '/dashboard');
      await refreshed;
      await page.waitForURL('**/dashboard');
      await page.waitForLoadState('networkidle');
      results.push({
        phase,
        result: 'PASS',
        legacySessionSurvivedMigration: true,
        refreshOrigin: oldApi,
      });
      fs.writeFileSync(
        path.join(directory, 'legacy-session-result.json'),
        JSON.stringify(results, null, 2),
      );
      await context.close();
      for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 390, height: 844 },
      ]) {
        step = 'canonical Owner browser ' + viewport.width;
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const requests = [],
          transportErrors = [],
          navigationAborts = [];
        let token;
        page.on('response', async (r) => {
          const url = new URL(r.url());
          if (url.pathname.startsWith('/api/'))
            requests.push({ origin: url.origin, path: url.pathname, status: r.status() });
          if (url.pathname === '/api/v1/auth/login' && r.status() === 200)
            token = (await r.json()).accessToken;
        });
        page.on('requestfailed', (r) => {
          const failure = {
            origin: new URL(r.url()).origin,
            path: new URL(r.url()).pathname,
            error: r.failure()?.errorText,
          };
          // Page navigation intentionally cancels in-flight dashboard requests.
          // Keep those in evidence without classifying them as CORS/TLS failures.
          (failure.error === 'net::ERR_ABORTED' ? navigationAborts : transportErrors).push(failure);
        });
        page.on('console', (message) => {
          if (message.type() === 'error' && /cors|mixed content|certificate/i.test(message.text()))
            transportErrors.push({ browser: 'transport error' });
        });
        await login(page, owner);
        step = 'canonical cookie attributes ' + viewport.width;
        const cookie = (await context.cookies(api + '/api/v1/auth')).find(
          (c) => c.name === '__Secure-bhome-refresh',
        );
        assert.ok(cookie && cookie.httpOnly && cookie.secure && cookie.sameSite === 'Strict');
        assert.equal(cookie.domain, new URL(api).hostname, 'Host-only API cookie');
        const previous = cookie.value;
        step = 'canonical refresh rotation ' + viewport.width;
        const refresh = page.waitForResponse(
          (r) => r.url() === api + '/api/v1/auth/refresh' && r.status() === 200,
        );
        await page.reload();
        await refresh;
        await page.waitForURL('**/dashboard');
        await page.waitForLoadState('networkidle');
        assert.ok(
          (await context.cookies(api + '/api/v1/auth')).find(
            (c) => c.name === '__Secure-bhome-refresh',
          )?.value !== previous,
        );
        step = 'CSRF missing client header ' + viewport.width;
        const missingHeader = await page.evaluate(
          async (api) =>
            (
              await fetch(api + '/api/v1/auth/refresh', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
              })
            ).status,
          api,
        );
        assert.equal(missingHeader, 403);
        step = 'Production rejects token ' + viewport.width;
        const productionRejection = await context.request.get(
          'https://api.103.146.23.157.sslip.io/api/v1/auth/me',
          { headers: { Authorization: 'Bearer ' + token } },
        );
        assert.equal(productionRejection.status(), 401);
        await page.goto(publicOrigin + '/locations');
        await page.getByText('Hiện chưa có cơ sở được công bố.', { exact: false }).waitFor();
        step = 'Public origin CSRF rejected ' + viewport.width;
        const publicOriginCsrf = await page.evaluate(
          async (api) =>
            (
              await fetch(api + '/api/v1/auth/refresh', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', 'X-BHome-Client': 'web' },
                body: '{}',
              })
            ).status,
          api,
        );
        assert.equal(publicOriginCsrf, 403);
        await page.reload();
        await page.getByText('Hiện chưa có cơ sở được công bố.', { exact: false }).waitFor();
        await page.screenshot({
          path: path.join(directory, 'public-' + viewport.width + '.png'),
          fullPage: true,
        });
        // Switch back to the authorized Owner origin before ending the session.
        await page.goto(owner + '/dashboard');
        await page.waitForURL('**/dashboard');
        await page.waitForLoadState('networkidle');
        step = 'canonical logout ' + viewport.width;
        const logout = await page.evaluate(
          async ({ api, token }) =>
            (
              await fetch(api + '/api/v1/auth/logout', {
                method: 'POST',
                credentials: 'include',
                headers: {
                  'Content-Type': 'application/json',
                  'X-BHome-Client': 'web',
                  Authorization: 'Bearer ' + token,
                },
                body: '{}',
              })
            ).status,
          { api, token },
        );
        assert.equal(logout, 204);
        await page.reload();
        await page.waitForURL('**/login');
        await page.waitForLoadState('networkidle');
        step = 'canonical network isolation ' + viewport.width;
        fs.writeFileSync(
          path.join(directory, 'network-' + viewport.width + '.json'),
          JSON.stringify({ requests, transportErrors, navigationAborts }, null, 2),
        );
        assert.ok(
          requests.length && requests.every((r) => r.origin === api),
          'Canonical pages must use only the new API',
        );
        assert.deepEqual(transportErrors, []);
        results.push({
          phase,
          viewport,
          result: 'PASS',
          requests,
          login: true,
          refreshRotation: true,
          logout: 204,
          csrfMissingHeader: 403,
          csrfPublicOrigin: 403,
          productionRejectsStagingToken: 401,
          hostOnlySecureCookie: true,
          transportErrors,
          navigationAborts,
        });
        await context.close();
      }
    }
    fs.writeFileSync(path.join(directory, phase + '.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ phase, result: 'PASS', checks: results.length }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(
    'Hostname browser check failed at ' +
      step +
      '; type=' +
      error.name +
      '; credentials and raw errors withheld',
  );
  process.exitCode = 1;
});
